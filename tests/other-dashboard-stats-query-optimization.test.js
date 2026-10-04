import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import {
  getStudentDashboardStats,
  getEmployerDashboardData,
  getAdminDashboardData,
} from "../controllers/dashboardController.js";

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

test("student dashboard stats keep four independent count filters in one statement", async () => {
  const { calls, releases, res } = await invoke(getStudentDashboardStats, { id: "student-1" }, {
    favorite_count: 4, announcement_count: 2, evaluation_count: 3, document_count: 7,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, stats: {
    favoriteInternships: 4, unreadAnnouncements: 2, pendingEvaluations: 3, documentsStored: 7,
  } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, Array(4).fill("student-1"));
  for (const fragment of [
    "favorited_at IS NOT NULL", "type = 'announcement' AND is_read = 0",
    "sem.internship_record_id = ir.id", "ir.user_id = ? AND sem.status = 'pending'",
    "FROM internship_documents", "WHERE user_id = ?",
  ]) assert.ok(calls[0].sql.includes(fragment), fragment);
  assert.equal(releases, 1);
});

test("employer dashboard stats count ongoing and finished interns from one scoped scan", async () => {
  const { calls, releases, res } = await invoke(getEmployerDashboardData, { id: "employer-1" }, {
    posting_count: 5, announcement_count: 1, ongoing_count: 3, finished_count: 8, document_count: 2,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.stats, {
    internshipPosts: 5, unreadAnnouncements: 1,
    internsHandled: { current: 3, past: 8 }, documentsUploaded: 2,
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].params, Array(4).fill("employer-1"));
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
