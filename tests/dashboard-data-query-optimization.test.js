import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import {
  getStudentDashboardData,
  getEmployerDashboardData,
  getAdminDashboardData,
} from "../controllers/dashboardController.js";

function response() {
  return { statusCode: 200, locals: {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

async function invoke(handler, user, answer) {
  const original = db.getConnection;
  const calls = [];
  let releases = 0;
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(sql, params) { calls.push({ sql, params }); return [await answer(sql, params, calls.length)]; },
  });
  try {
    const res = response();
    await handler({ verifiedUser: user }, res);
    return { res, calls, releases };
  } finally {
    db.getConnection = original;
  }
}

test("student dashboard keeps today's first row and independent live status with a date range", async () => {
  const internship = { id: "i-1", status: "ongoing", company_name: "Acme" };
  const today = { id: 11, clock_in: "in", clock_out: null, created_at: "today", status: "present" };
  const latest = { id: 12, clock_in: "latest-in", clock_out: null };
  const { res, calls, releases } = await invoke(getStudentDashboardData, { id: "u-1" }, (sql) => {
    if (sql.includes("SELECT * FROM internship_records")) return [internship];
    if (sql.includes("FROM daily_time_records") && sql.includes("created_at >= CURDATE()")) return [today];
    if (sql.includes("ORDER BY id DESC")) return [latest];
    if (sql.includes("LEFT JOIN dtr_locations")) return [{ dtr_location_id: null, company_lat: 14, company_lon: 121 }];
    throw new Error("Unexpected query");
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, internshipData: internship, dtrToday: today,
    dtrStatus: { status: "CLOCKED_IN", record: latest },
    location: { lat: 14, lon: 121, radius_meters: 150, label: "Company address (default)",
      address: null, set_by: null, created_at: null, updated_at: null } });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[1].params, ["u-1", "i-1"]);
  assert.match(calls[1].sql, /created_at >= CURDATE\(\).*created_at < CURDATE\(\) \+ INTERVAL 1 DAY/s);
  assert.doesNotMatch(calls[1].sql, /DATE\(created_at\)/);
  assert.equal(releases, 1);
});

test("employer dashboard keeps every joined intern and strips the internal posting total", async () => {
  const interns = [{ internship_id: "i-1", course_name: "IT" }, { internship_id: "i-1", course_name: "CS" }];
  const jobs = [{ id: "p-1", position: "Developer", total_postings: 7 },
    { id: "p-2", position: "Designer", total_postings: 7 }];
  const { res, calls } = await invoke(getEmployerDashboardData, { id: "e-1" }, (sql) =>
    sql.includes("FROM internship_records ir") ? interns : jobs);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, interns, postedJobs: {
    jobs: [{ id: "p-1", position: "Developer" }, { id: "p-2", position: "Designer" }],
    totalPages: 2, currentPage: 1,
  } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].params, ["e-1", "e-1", 5]);
  assert.match(calls[1].sql, /ORDER BY created_at DESC\s+LIMIT \?/);
  assert.match(calls[1].sql, /SELECT COUNT\(\*\) FROM internship_postings/);
});

test("employer dashboard keeps empty first-page and independent failure fallbacks", async () => {
  const empty = await invoke(getEmployerDashboardData, { id: "e-1" }, (sql) =>
    sql.includes("FROM internship_records ir") ? [{ internship_id: "i-1" }] : []);
  assert.equal(empty.res.body.postedJobs.totalPages, 0);
  assert.deepEqual(empty.res.body.postedJobs.jobs, []);

  const originalError = console.error;
  console.error = () => {};
  try {
    const failed = await invoke(getEmployerDashboardData, { id: "e-1" }, (sql) => {
      if (sql.includes("FROM internship_records ir")) return [{ internship_id: "i-1" }];
      throw new Error("postings unavailable");
    });
    assert.equal(failed.res.statusCode, 200);
    assert.deepEqual(failed.res.body.interns, [{ internship_id: "i-1" }]);
    assert.deepEqual(failed.res.body.postedJobs, { jobs: [], totalPages: 1, currentPage: 1 });
    assert.equal(failed.res.locals.skipCache, true);
  } finally {
    console.error = originalError;
  }
});

test("admin dashboard retains separate sections and narrows only the academic join", async () => {
  const byRole = [{ role: "student", count: 2 }];
  const byDepartment = [{ department_id: 1, department_name: "Computing", department_code: "CCS", interns: 3 }];
  const activity = [{ id: "log-1", action: "created" }];
  const { res, calls } = await invoke(getAdminDashboardData, { id: "admin" }, (sql) => {
    if (sql.includes("DATE_FORMAT(u.created_at")) return [];
    if (sql.includes("GROUP BY r.role")) return byRole;
    if (sql.includes("GROUP BY d.id")) return byDepartment;
    if (sql.includes("FROM activity_logs")) return activity;
    throw new Error("Unexpected query");
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 4);
  assert.deepEqual(res.body.usersByRole, byRole);
  assert.deepEqual(res.body.ongoingByDepartment, byDepartment);
  assert.deepEqual(res.body.recentActivity, activity);
  assert.ok(Array.isArray(res.body.userGrowth));
  assert.match(calls[2].sql, /SELECT sai1\.user_id, sai1\.department_id/);
  assert.doesNotMatch(calls[2].sql, /SELECT sai1\.\*/);
});
