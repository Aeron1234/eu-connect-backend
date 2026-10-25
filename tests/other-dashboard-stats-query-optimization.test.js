import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import {
  getStudentDashboardStats,
  getEmployerDashboardData,
  getAdminDashboardData,
} from "../features/dashboard/controllers/dashboardController.js";

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function invoke(handler, user, countRow) {
  const original = db.getConnection;
  const calls = [];
  let releases = 0;
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(sql, params) {
      calls.push({ sql, params });
      return sql.includes("COUNT(*)") ? [[countRow]] : [[]];
    },
  });
  try {
    const res = response();
    res.locals = {};
    await handler({ verifiedUser: user }, res);
    return { calls, releases, res };
  } finally {
    db.getConnection = original;
  }
}

test("student dashboard stats exclude confidential employer evaluation counts", async () => {
  const { calls, releases, res } = await invoke(getStudentDashboardStats, { id: "student-1" }, {
    favorite_count: 4, announcement_count: 2, evaluation_count: 3, document_count: 7, ongoing_internship_id: "record-1", missing_count: 2,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, stats: {
    favoriteInternships: 4, unreadAnnouncements: 2, documentsStored: 7, hasOngoingInternship: true, missingRequirements: 2,
  } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, Array(5).fill("student-1"));
  for (const fragment of [
    "favorited_at IS NOT NULL", "type = 'announcement' AND is_read = 0",
    "FROM internship_documents", "WHERE user_id = ?",
  ]) assert.ok(calls[0].sql.includes(fragment), fragment);
  assert.doesNotMatch(calls[0].sql, /student_evaluation_masters/);
  assert.equal(releases, 1);
});

test("employer dashboard stats count ongoing and finished interns from one scoped scan", async () => {
  const { calls, releases, res } = await invoke(getEmployerDashboardData, { id: "employer-1" }, {
    posting_count: 5, announcement_count: 1, ongoing_count: 3, finished_count: 8, document_count: 2,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.stats, {
    internshipPosts: 5,
    internsHandled: { current: 3, past: 8 }, documentsUploaded: 2,
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].params, Array(3).fill("employer-1"));
  assert.doesNotMatch(calls[0].sql, /FROM notifications/);
  assert.equal((calls[0].sql.match(/FROM internship_records/g) ?? []).length, 1);
  assert.match(calls[0].sql, /WHERE employer_id = \? AND status IN \('ongoing', 'finished'\)/);
  assert.match(calls[0].sql, /COUNT\(CASE WHEN status = 'ongoing'/);
  assert.match(calls[0].sql, /COUNT\(CASE WHEN status = 'finished'/);
  assert.match(calls[0].sql, /uploaded_by_id = \? AND uploaded_by_role = 'employer'/);
  assert.equal(releases, 1);
});

test("admin dashboard stats include role-less users in inactive count", async () => {
  const { calls, releases, res } = await invoke(getAdminDashboardData, { id: "admin-1" }, {
    ongoing_count: 9, employer_count: 4, student_count: 12, inactive_count: 6,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.stats, {
    ongoingInternships: 9, employers: 4, students: 12, inactiveOrSuspended: 6,
  });
  assert.equal(calls.length, 5);
  assert.equal(calls[0].params, undefined);
  assert.equal((calls[0].sql.match(/FROM users u/g) ?? []).length, 1);
  assert.match(calls[0].sql, /LEFT JOIN roles r ON r.id = u.role_id/);
  assert.match(calls[0].sql, /u.status IN \('inactive', 'suspended'\)/);
  assert.equal(releases, 1);
});
