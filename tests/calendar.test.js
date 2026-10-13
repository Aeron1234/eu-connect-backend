import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import {
  getCalendarMonth,
  getCalendarSchedule,
  createCalendarTodo,
  createCalendarSchedule,
  updateCalendarSchedule,
  deleteCalendarSchedule,
} from "../controllers/calendarControllers.js";

const originalExecute = db.execute;
const originalGetConnection = db.getConnection;
after(async () => {
  db.execute = originalExecute;
  db.getConnection = originalGetConnection;
  await db.end();
});

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("month feed reads the full date range and scopes announcement and schedule visibility", async () => {
  const calls = [];
  db.execute = async (sql, params) => {
    calls.push({ sql, params });
    return [[]];
  };
  const res = response();
  await getCalendarMonth({ verifiedUser: { id: "student", role: "student", department_id: 7 }, query: { month: "2026-10" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0].params, ["2026-10-01", "2026-11-01", "student", 7]);
  assert.match(calls[0].sql, /author_dept\.department_id = \?/);
  assert.deepEqual(calls[1].params, ["2026-11-01", "2026-10-01", "student", 7]);
  assert.deepEqual(calls[3].params, ["student", "2026-10-01", "2026-11-01"]);
  assert.deepEqual(res.body, { announcements: [], schedules: [], internship: null, todos: [] });
});

test("employers receive only school-wide calendar items without internship or to-do queries", async () => {
  const calls = [];
  db.execute = async (sql, params) => {
    calls.push({ sql, params });
    return [[]];
  };
  const res = response();
  await getCalendarMonth({ verifiedUser: { id: "employer", role: "employer", department_id: 7 }, query: { month: "2026-10" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, ["2026-10-01", "2026-11-01", "employer", -1]);
  assert.deepEqual(calls[1].params, ["2026-11-01", "2026-10-01", "employer", -1]);
  assert.deepEqual(res.body, { announcements: [], schedules: [], internship: null, todos: [] });
});

test("employers can open school-wide schedules but not department schedules", async () => {
  db.execute = async () => [[{ id: 42, department_id: null, title: "Campus event" }]];
  const request = { verifiedUser: { id: "employer", role: "employer", department_id: 7 }, params: { id: "42" } };
  const allowed = response();
  await getCalendarSchedule(request, allowed);
  assert.equal(allowed.statusCode, 200);

  db.execute = async () => [[{ id: 42, department_id: 7, title: "Department deadline" }]];
  const denied = response();
  await getCalendarSchedule(request, denied);
  assert.equal(denied.statusCode, 404);
});

test("a private to-do requires a real date inside the student's ongoing internship", async () => {
  let inserts = 0;
  db.execute = async (sql) => {
    if (sql.includes("SELECT id FROM internship_records")) return [[]];
    inserts++;
    return [{ insertId: 9 }];
  };
  const invalid = response();
  await createCalendarTodo({ verifiedUser: { id: "student" }, body: { title: "Report", date: "2026-02-30" } }, invalid);
  assert.equal(invalid.statusCode, 400);
  const outside = response();
  await createCalendarTodo({ verifiedUser: { id: "student" }, body: { title: "Report", date: "2026-10-07" } }, outside);
  assert.equal(outside.statusCode, 400);
  assert.equal(inserts, 0);
});

test("department schedules notify only selected students after commit", async () => {
  let committed = false;
  const emitted = [];
  const writes = [];
  db.getConnection = async () => ({
    async beginTransaction() {}, async rollback() {}, release() {},
    async commit() { committed = true; },
    async execute(sql, params) {
      writes.push({ sql, params });
      if (sql.includes("INSERT INTO calendar_schedules")) return [{ insertId: 42 }];
      if (sql.includes("SELECT DISTINCT u.id")) return [[{ id: "student-a" }]];
      throw new Error("Unexpected query");
    },
    async query(sql, values) { writes.push({ sql, values }); return [{ affectedRows: 1 }]; },
  });
  const req = {
    verifiedUser: { id: "head", role: "department_head", department_id: 7 },
    body: { title: "Submit narrative", description: "Before noon", starts_on: "2026-10-15", ends_on: "2026-10-15" },
    app: { get: () => ({ to: (room) => ({ emit: (name, payload) => { assert.ok(committed); emitted.push({ room, name, payload }); } }) }) },
  };
  const res = response();
  await createCalendarSchedule(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(writes[0].params[1], 7);
  assert.deepEqual(writes[1].params, [7, 7]);
  assert.equal(writes[2].values[0][0][0], "student-a");
  assert.equal(writes[2].values[0][0][2], "calendar_schedule");
  assert.deepEqual(emitted.map(({ room }) => room), ["user-student-a"]);
});

test("schedule edits replace stale alerts and deletion sends a cancellation", async () => {
  const calls = [];
  db.getConnection = async () => ({
    async beginTransaction() {}, async rollback() {}, async commit() {}, release() {},
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT created_by, department_id, title")) {
        return [[{ created_by: "head", department_id: 7, title: "Old deadline", starts_on: "2026-10-15" }]];
      }
      if (sql.includes("SELECT created_by, department_id FROM")) {
        return [[{ created_by: "head", department_id: 7 }]];
      }
      if (sql.includes("SELECT DISTINCT u.id")) return [[{ id: "student-a" }]];
      return [{ affectedRows: 1 }];
    },
    async query(sql, values) { calls.push({ sql, values }); return [{ affectedRows: 1 }]; },
  });
  const req = {
    verifiedUser: { id: "head", role: "department_head", department_id: 7 },
    params: { id: "42" },
    body: { title: "New deadline", description: "Bring documents", starts_on: "2026-10-16", ends_on: "2026-10-16" },
    app: { get: () => null },
  };
  const edited = response();
  await updateCalendarSchedule(req, edited);
  assert.equal(edited.statusCode, 200);
  assert.ok(calls.findIndex((call) => call.sql.startsWith("DELETE FROM notifications")) < calls.findIndex((call) => call.sql.startsWith("INSERT INTO notifications")));
  assert.equal(calls.find((call) => call.sql.startsWith("INSERT INTO notifications")).values[0][0][3], "Calendar schedule updated");

  calls.length = 0;
  const deleted = response();
  await deleteCalendarSchedule(req, deleted);
  assert.equal(deleted.statusCode, 200);
  const canceled = calls.find((call) => call.sql.startsWith("INSERT INTO notifications")).values[0][0];
  assert.equal(canceled[3], "Calendar schedule canceled");
  assert.equal(canceled[5], null);
});
