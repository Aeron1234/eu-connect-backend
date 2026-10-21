import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { db } from "../config/db.js";
import cache from "../config/cache/cache.js";
import * as student from "../features/evaluations/controllers/studentEvaluationControllers.js";
import { getPendingStudentEvaluations } from "../features/evaluations/controllers/employerEvaluationsController.js";
import { getAllNotifications, getUnreadNotificationCount } from "../features/notifications/controllers/notificationControllers.js";

process.env.ACCESS_TOKEN_SECRET = "confidential-evaluation-test";
process.env.CACHE_ENABLED = "true";
const { default: evaluationRoutes } = await import("../features/evaluations/routes/studentEvaluationRoutes.js");
const { default: calendarRoutes } = await import("../features/calendar/routes/calendarRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const original = db.getConnection;
beforeEach(() => cache.flushAll());
after(async () => { db.getConnection = original; cache.close(); await db.end(); });
const response = () => ({ statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const request = (role = "student", id = role) => ({ verifiedUser: { role, id, department_id: 999 },
  params: { studentId: "student", evaluationId: "evaluation" }, query: {} });

test("students cannot read, print, confirm, dispute or restore employer evaluations, including legacy entries", async () => {
  let calls = 0; db.getConnection = async () => { calls++; throw Error("Private data must not be read"); };
  for (const handler of [student.getStudentCompleteEvaluations, student.getPastStudentEvaluations, student.getStudentEvaluationForPrint,
    student.getDisputedStudentEvaluations, getPendingStudentEvaluations, student.respondToStudentEvaluation, student.restoreDisputedEvaluation]) {
    const res = response(); await handler(request(), res);
    assert.equal(res.statusCode, 403, handler.name); assert.equal(calls, 0);
  }
});

test("student history reads only their own submitted supervisor feedback", async () => {
  const queries = [];
  db.getConnection = async () => ({ release() {}, async execute(sql, params) {
    queries.push(sql); assert(!sql.includes("FROM student_evaluation_masters"));
    assert.deepEqual(params, ["student"]);
    return [[{ evaluation_id: "own-feedback", submitted_date: "2026-10-21", breakdown_label: "Support", breakdown_score: 4 }]];
  } });
  const res = response(); await student.getAllStudentEvaluations(request(), res);
  assert.equal(res.statusCode, 200); assert.equal(queries.length, 1);
  assert.deepEqual(res.body.data.map(item => item.type), ["Supervisor Evaluation"]);
});

test("PDF and profile reads scope employer authors and the student's current department using database membership", async () => {
  for (const role of ["employer", "department_head", "admin"]) {
    for (const allowed of [true, false]) {
      let queries = 0;
      db.getConnection = async () => ({ release() {}, async execute(sql, params) {
        queries++;
        if (sql.includes("student_evaluation_scores ses")) return [[{ category: "Skills", criterion_name: "Quality", score: 5 }]];
        assert.match(sql, /ir.deleted_at IS NULL/);
        if (role === "employer") { assert.match(sql, /sem.evaluated_by = \?/); assert.equal(params[1], role); }
        if (role === "department_head") {
          assert.match(sql, /evaluation_head.user_id = \?/); assert.match(sql, /MAX\(latest_student.id\)/);
          assert.equal(params[1], role); assert(!params.includes(999));
        }
        return [allowed ? [{ id: "evaluation", status: "pending", first_name: "Test", last_name: "Student" }] : []];
      } });
      const res = response(); await student.getStudentEvaluationForPrint(request(role), res);
      assert.equal(res.statusCode, allowed ? 200 : 404); assert.equal(queries, allowed ? 2 : 1);
    }
    let sqlRead, paramsRead;
    db.getConnection = async () => ({ release() {}, async execute(sql, params) { sqlRead = sql; paramsRead = params; return [[]]; } });
    const res = response(); await student.getPastStudentEvaluations(request(role), res);
    assert.equal(res.statusCode, 200);
    if (role === "employer") { assert.match(sqlRead, /m.evaluated_by = \?/); assert.deepEqual(paramsRead, ["student", role]); }
    if (role === "department_head") { assert.match(sqlRead, /evaluation_head.user_id = \?/); assert(!paramsRead.includes(999)); }
  }
});

test("submission is completed immediately, notifies only matching department heads, and emits after commit", async () => {
  for (const failCommit of [false, true]) {
    cache.set("history", { path: "/api/v1/evaluations/all", userId: "student", body: {} });
    let committed = false, rolledBack = false; const notifications = [], rooms = [], writes = [];
    db.getConnection = async () => ({
      async beginTransaction() {}, async rollback() { rolledBack = true; }, release() {},
      async commit() { assert(cache.has("history")); if (failCommit) throw Error("commit failed"); committed = true; },
      async execute(sql, params) {
        if (sql.includes("FROM internship_records")) return [[{ id: "record-uuid", date_started: "2000-01-01", employer_id: "employer", company_name: "Company" }]];
        if (sql.includes("FROM user_profiles")) return [[{ first_name: "Test", last_name: "Employer" }]];
        if (sql.includes("SELECT DISTINCT u.id")) {
          assert.match(sql, /r.role = 'department_head'/); assert.match(sql, /u.deleted_at IS NULL/);
          assert.match(sql, /ORDER BY id DESC LIMIT 1/); assert.deepEqual(params, ["student"]);
          return [[{ id: "head-a" }, { id: "head-b" }]];
        }
        writes.push(sql);
        if (sql.includes("INSERT INTO notifications")) notifications.push(params);
        return [{ affectedRows: 1 }];
      },
    });
    const req = { ...request("employer"), body: { student_id: "student", scores: Array.from({ length: 29 }, (_, i) => ({ criterion_name: `Skill ${i}`, score: 5 })) },
      app: { get: () => ({ to: room => ({ emit(event, payload) { assert(committed); assert(!cache.has("history")); rooms.push(room); assert.equal(payload.link, "record-uuid"); } }) }) } };
    const res = response(), log = console.log; console.log = () => {};
    try { await student.createStudentEvaluation(req, res); } finally { console.log = log; }
    assert.equal(res.statusCode, failCommit ? 500 : 201);
    assert(writes.some(sql => sql.includes("INSERT INTO student_evaluation_masters") && !sql.includes("status")));
    assert.deepEqual(notifications.map(row => row[0]), ["head-a", "head-b"]);
    assert(notifications.every(row => row[4] === "record-uuid" && row[5] === notifications[0][5]));
    assert.deepEqual(rooms, failCommit ? [] : ["user-head-a", "user-head-b"]);
    assert.equal(cache.has("history"), failCommit); assert.equal(rolledBack, failCommit);
  }
});

test("legacy private evaluation notifications are excluded from student inboxes and unread counts", async () => {
  const rows = [{ type: "evaluation_submitted" }, { type: "evaluation_deleted" }, { type: "announcement" }];
  db.getConnection = async () => ({ release() {}, async execute(sql) {
    assert.match(sql, /type NOT IN \('evaluation_submitted', 'evaluation_deleted'\)/);
    const visible = rows.filter(row => !["evaluation_submitted", "evaluation_deleted"].includes(row.type));
    if (sql.includes("AS all_total")) return [[{ all_total: visible.length, unread_count: visible.length, request_total: 0 }]];
    if (sql.includes("AS unread_count")) return [[{ unread_count: visible.length }]];
    return [visible.map((row, i) => ({ ...row, notification_id: i + 1 }))];
  } });
  const inbox = response(), count = response();
  await getAllNotifications(request(), inbox); await getUnreadNotificationCount(request(), count);
  assert.equal(inbox.body.totalRecords, 1); assert.equal(inbox.body.unreadCount, 1);
  assert.deepEqual(inbox.body.data.map(item => item.type), ["announcement"]); assert.equal(count.body.unreadCount, 1);
});

test("HTTP guards block employer calendar URLs and student evaluation URLs before database or cached data", async t => {
  let calls = 0; db.getConnection = async () => { calls++; throw Error("Blocked route read DB"); };
  const app = express(); app.use("/api/v1", evaluationRoutes, calendarRoutes);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  for (const [path, role] of [["/calendar?month=2026-10", "employer"], ["/calendar/schedules/1", "employer"],
    ["/student-past-evaluations/student", "student"], ["/student-evaluations/student", "student"], ["/evaluations/student/evaluation/print", "student"]]) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`, { headers: { Authorization: `Bearer ${signAccessToken({ id: role, role })}` } });
    assert.equal(res.status, 403, path);
  }
  assert.equal(calls, 0);
});
