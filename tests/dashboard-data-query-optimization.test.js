import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import {
  getStudentDashboardData,
  getEmployerDashboardData,
  getEmployerInternsPage,
  getDepartmentHeadDashboardData,
  getDepartmentStudentHoursPage,
  getAdminDashboardData,
} from "../controllers/dashboardController.js";

function response() {
  return { statusCode: 200, locals: {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

async function invoke(handler, user, answer, query = {}) {
  const original = db.getConnection;
  const calls = [];
  let releases = 0;
  let acquisitions = 0;
  db.getConnection = async () => {
    acquisitions++;
    return {
      release() { releases++; },
      async execute(sql, params) { calls.push({ sql, params }); return [await answer(sql, params, calls.length)]; },
    };
  };
  try {
    const res = response();
    await handler({ verifiedUser: user, query }, res);
    return { res, calls, releases, acquisitions };
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

test("department dashboard sends only the first hours page and a full-course chart aggregate", async () => {
  const { res, calls, releases } = await invoke(
    getDepartmentHeadDashboardData,
    { id: "head-1", department_id: 7 },
    (sql, params) => {
      if (sql.includes("COUNT(*) AS total_count")) return [{ total_count: 23, ongoing_count: 23, pending_count: 0 }];
      if (sql.includes("FROM alumni_internship_records")) return [{ count: 0 }];
      if (sql.includes("FROM notifications")) return [{ count: 0 }];
      if (sql.includes("COUNT(*) AS total FROM internship_records")) return [{ total: 23 }];
      if (sql.includes("LIMIT ? OFFSET ?")) {
        assert.deepEqual(params, [7, 10, 0]);
        return [{ internship_id: "internship-1", student_id: "student-1", first_name: "Juan", last_name: "Dela Cruz", course: "BSCS", accumulated_hours: 20.75, total_hours: 100, at_risk: 1 }];
      }
      if (sql.includes("FROM courses") && sql.includes("is_active = 1")) return [{ id: 3, short_name: "BSCS" }];
      if (sql.includes("AS completion_sum")) return [{ course: "BSCS", student_count: 23, completion_sum: 1150, at_risk_count: 4 }];
      return [];
    },
  );
  assert.equal(res.statusCode, 200);
  assert.equal(releases, 1);
  assert.deepEqual(res.body.hoursTracker, {
    students: [{ id: "internship-1", student_id: "student-1", name: "Juan Dela Cruz", course: "BSCS", company: undefined, accumulated_hours: 20.75, total_hours: 100, atRisk: true, date_started: undefined, date_ended: undefined }],
    courses: [{ id: 3, short_name: "BSCS" }], page: 1, pageSize: 10, total: 23, totalPages: 3,
  });
  assert.deepEqual(res.body.hoursDistribution, [{ course: "BSCS", studentCount: 23, avgCompletion: 50, atRiskCount: 4 }]);
  assert.match(calls.find(({ sql }) => sql.includes("AS completion_sum")).sql, /GROUP BY c\.short_name/);
  const rowSql = calls.find(({ sql }) => sql.includes("AS at_risk")).sql;
  const chartSql = calls.find(({ sql }) => sql.includes("AS at_risk_count")).sql;
  const riskRule = /TIMESTAMPDIFF\(MICROSECOND, CURRENT_TIMESTAMP\(6\), ir\.date_ended\)[\s\S]*\* 40 \/ 604800000000/;
  assert.match(rowSql, riskRule);
  assert.match(chartSql, riskRule);
});

test("department hours endpoint filters and pages by verified department with stable ordering", async () => {
  const { res, calls, releases } = await invoke(
    getDepartmentStudentHoursPage,
    { id: "head-1", department_id: 7 },
    (sql) => sql.includes("COUNT(*) AS total") ? [{ total: 23 }]
      : [{ internship_id: "internship-11", student_id: "student-11", first_name: "Ana", last_name: "Santos", course: "BSCS", accumulated_hours: 31.25, total_hours: 100, at_risk: 0 }],
    { page: "2", courseId: "3", search: "ana" },
  );
  assert.equal(res.statusCode, 200);
  assert.equal(releases, 1);
  assert.deepEqual(res.body.students[0].student_id, "student-11");
  assert.equal(res.body.students[0].atRisk, false);
  assert.deepEqual([res.body.page, res.body.total, res.body.totalPages], [2, 23, 3]);
  assert.deepEqual(calls[0].params, [7, 3, "ana"]);
  assert.deepEqual(calls[1].params, [7, 3, "ana", 10, 10]);
  assert.match(calls[1].sql, /ORDER BY ir\.date_started DESC, ir\.id DESC/);
  assert.match(calls[1].sql, /LIMIT \? OFFSET \?/);

  const outOfRange = await invoke(getDepartmentStudentHoursPage, { id: "head-1", department_id: 7 }, () => [{ total: 2 }], { page: "9" });
  assert.deepEqual(outOfRange.res.body.students, []);
  assert.equal(outOfRange.calls.length, 1);
});

test("invalid hours page filters never acquire a database connection", async () => {
  for (const query of [{ page: "0" }, { courseId: "1 OR 1=1" }, { search: "a".repeat(101) }]) {
    const { res, calls, acquisitions } = await invoke(getDepartmentStudentHoursPage, { id: "head-1", department_id: 7 }, () => { throw new Error("unexpected query"); }, query);
    assert.equal(res.statusCode, 400);
    assert.equal(calls.length, 0);
    assert.equal(acquisitions, 0);
  }
});

test("employer dashboard bounds interns to the first page and strips the internal posting total", async () => {
  const interns = [{ internship_id: "i-1", course_name: "IT" }, { internship_id: "i-2", course_name: "CS" }];
  const jobs = [{ id: "p-1", position: "Developer", total_postings: 7 },
    { id: "p-2", position: "Designer", total_postings: 7 }];
  const { res, calls } = await invoke(getEmployerDashboardData, { id: "e-1" }, (sql) =>
    sql.includes("AS intern_counts") ? [{ posting_count: 2, announcement_count: 1, ongoing_count: 1, finished_count: 1, document_count: 3 }]
      : sql.includes("COUNT(*) AS total FROM internship_records ir") ? [{ total: 7 }]
      : sql.includes("FROM internship_records ir") ? interns : jobs);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, stats: {
    internshipPosts: 2, unreadAnnouncements: 1,
    internsHandled: { current: 1, past: 1 }, documentsUploaded: 3,
  }, interns, internsPagination: { page: 1, pageSize: 5, total: 7, totalPages: 2 }, postedJobs: {
    jobs: [{ id: "p-1", position: "Developer" }, { id: "p-2", position: "Designer" }],
    totalPages: 2, currentPage: 1,
  } });
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[2].params, ["e-1", 5, 0]);
  assert.match(calls[2].sql, /sai\.id = \(\s*SELECT MAX\(sai_latest\.id\)/);
  assert.match(calls[2].sql, /ORDER BY ir\.date_started DESC, ir\.id DESC\s+LIMIT \? OFFSET \?/);
  assert.deepEqual(calls[3].params, ["e-1", "e-1", 5, 0]);
  assert.match(calls[3].sql, /ORDER BY created_at DESC, id DESC\s+LIMIT \? OFFSET \?/);
  assert.match(calls[3].sql, /SELECT COUNT\(\*\) FROM internship_postings/);
});

test("employer dashboard keeps empty first-page and independent failure fallbacks", async () => {
  const empty = await invoke(getEmployerDashboardData, { id: "e-1" }, (sql) =>
    sql.includes("AS intern_counts") ? [{}]
      : sql.includes("COUNT(*) AS total FROM internship_records ir") ? [{ total: 1 }]
      : sql.includes("FROM internship_records ir") ? [{ internship_id: "i-1" }] : []);
  assert.equal(empty.res.body.postedJobs.totalPages, 0);
  assert.deepEqual(empty.res.body.postedJobs.jobs, []);

  const originalError = console.error;
  console.error = () => {};
  try {
    const failed = await invoke(getEmployerDashboardData, { id: "e-1" }, (sql) => {
      if (sql.includes("AS intern_counts")) return [{}];
      if (sql.includes("COUNT(*) AS total FROM internship_records ir")) return [{ total: 1 }];
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

test("employer intern pages filter by status without duplicating academic rows", async () => {
  const intern = { internship_id: "i-6", student_id: "s-6", status: "finished", course_name: "IT" };
  const { res, calls, releases } = await invoke(
    getEmployerInternsPage, { id: "e-1" },
    (sql) => sql.includes("COUNT(*) AS total") ? [{ total: 8 }] : [intern],
    { page: "2", status: "finished" },
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true, interns: [intern], page: 2, pageSize: 5, total: 8, totalPages: 2,
  });
  assert.deepEqual(calls[0].params, ["e-1", "finished"]);
  assert.deepEqual(calls[1].params, ["e-1", "finished", 5, 5]);
  assert.match(calls[1].sql, /sai\.id = \(\s*SELECT MAX\(sai_latest\.id\)/);
  assert.match(calls[1].sql, /ORDER BY ir\.date_started DESC, ir\.id DESC\s+LIMIT \? OFFSET \?/);
  assert.equal(releases, 1);
});

test("invalid employer pagination never acquires a database connection", async () => {
  for (const [handler, query] of [
    [getEmployerDashboardData, { jobPage: "0" }],
    [getEmployerInternsPage, { page: "0" }],
    [getEmployerInternsPage, { page: "1", status: "other" }],
  ]) {
    const { res, acquisitions } = await invoke(handler, { id: "e-1" }, () => { throw new Error("unexpected query"); }, query);
    assert.equal(res.statusCode, 400);
    assert.equal(acquisitions, 0);
  }
});

test("employer dashboard fetches the requested jobs page through its existing connection", async () => {
  const { res, calls, acquisitions } = await invoke(
    getEmployerDashboardData, { id: "e-1" },
    (sql) => sql.includes("AS intern_counts") ? [{}]
      : sql.includes("COUNT(*) AS total FROM internship_records ir") ? [{ total: 0 }]
      : [{ id: "p-6", total_postings: 12 }],
    { jobPage: "2" },
  );
  assert.deepEqual(res.body.postedJobs, {
    jobs: [{ id: "p-6" }], totalPages: 3, currentPage: 2,
  });
  assert.deepEqual(calls.at(-1).params, ["e-1", "e-1", 5, 5]);
  assert.equal(acquisitions, 1);
});

test("admin dashboard retains separate sections and narrows only the academic join", async () => {
  const byRole = [{ role: "student", count: 2 }];
  const byDepartment = [{ department_id: 1, department_name: "Computing", department_code: "CCS", interns: 3 }];
  const activity = [{ id: "log-1", action: "created" }];
  const { res, calls } = await invoke(getAdminDashboardData, { id: "admin" }, (sql) => {
    if (sql.includes("AS ongoing_count")) return [{ ongoing_count: 3, employer_count: 2, student_count: 5, inactive_count: 1 }];
    if (sql.includes("DATE_FORMAT(u.created_at")) return [];
    if (sql.includes("GROUP BY r.role")) return byRole;
    if (sql.includes("GROUP BY d.id")) return byDepartment;
    if (sql.includes("FROM activity_logs")) return activity;
    throw new Error("Unexpected query");
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 5);
  assert.deepEqual(res.body.stats, { ongoingInternships: 3, employers: 2, students: 5, inactiveOrSuspended: 1 });
  assert.deepEqual(res.body.usersByRole, byRole);
  assert.deepEqual(res.body.ongoingByDepartment, byDepartment);
  assert.deepEqual(res.body.recentActivity, activity);
  assert.ok(Array.isArray(res.body.userGrowth));
  assert.match(calls[3].sql, /SELECT sai1\.user_id, sai1\.department_id/);
  assert.doesNotMatch(calls[3].sql, /SELECT sai1\.\*/);
});
