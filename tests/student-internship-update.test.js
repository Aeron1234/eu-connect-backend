import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import cache from "../config/cache/cache.js";
import { db } from "../config/db.js";

process.env.ACCESS_TOKEN_SECRET = "student-update-test";
process.env.REFRESH_TOKEN_SECRET = "student-update-refresh";
process.env.TEMP_PASSWORD_SECRET = "student-update-temp";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_KEY = "no-network";
const { default: routes } = await import("../features/internship-records/routes/internshipRecordRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const originalGetConnection = db.getConnection;
const originalExecute = db.execute;
const valid = { company_name: "Updated Company", company_address: "Lucena City", internship_position: "Developer intern", company_website: "", description: "Development tasks", date_started: "2026-10-18", date_ended: "2026-12-31", total_hours: "200", region_id: "4", semester: "1st", lat: "13.94", lon: "121.61" };
let record, calls, commits, rollbacks, releases, failWrite, affectedRows, validRegion;

beforeEach(() => {
  cache.flushAll();
  record = { id: "record-1", user_id: "student-1", status: "pending", deleted_at: null, company_name: "Original company", employer_id: null, created_at: "2026-10-01", accumulated_hours: 0 };
  calls = []; commits = 0; rollbacks = 0; releases = 0; failWrite = false; affectedRows = 1; validRegion = true;
  db.execute = async () => [[]];
  db.getConnection = async () => ({
    async beginTransaction() { calls.push({ sql: "BEGIN" }); },
    async commit() { commits += 1; calls.push({ sql: "COMMIT" }); },
    async rollback() { rollbacks += 1; },
    release() { releases += 1; },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM internship_records WHERE id = ? FOR UPDATE")) return [record ? [{ ...record }] : []];
      if (sql.includes("SELECT id FROM regions")) return [validRegion ? [{ id: 4 }] : []];
      if (sql.includes("UPDATE internship_records")) {
        if (failWrite) throw new Error("database unavailable");
        return [{ affectedRows }];
      }
      if (sql.includes("SELECT first_name, last_name FROM user_profiles")) return [[{ first_name: "Test", last_name: "Student" }]];
      return [{ affectedRows: 1 }];
    },
  });
});

after(async () => {
  db.getConnection = originalGetConnection; db.execute = originalExecute;
  cache.close(); await db.end();
});

async function client(t) {
  const app = express();
  app.use("/api/v1", routes);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return (body = valid, role = "student", userId = "student-1") => {
    const form = new FormData();
    for (const [name, value] of Object.entries(body)) {
      for (const item of Array.isArray(value) ? value : [value]) form.append(name, item);
    }
    return fetch(`http://127.0.0.1:${server.address().port}/api/v1/internship-records/mine/record-1`, {
      method: "PATCH", body: form,
      headers: userId ? { Authorization: `Bearer ${signAccessToken({ id: userId, role })}` } : {},
    });
  };
}

function seedCache() {
  for (const path of ["/api/v1/internships/all", "/api/v1/internships/my-past-internships", "/api/v1/internship-records/department", "/api/v1/internship-records/overview/record-1", "/api/v1/notifications", "/api/v1/dashboard/student", "/api/v1/activity-logs", "/api/v1/departments"]) {
    cache.set(path, { path, userId: "student-1", body: [] });
  }
}

test("student updates the same pending record and invalidates affected caches after commit", async (t) => {
  const request = await client(t); seedCache();
  const response = await request(); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.success, true);
  assert.equal(body.record.id, "record-1"); assert.equal(body.record.status, "pending");
  assert.equal(body.record.company_name, valid.company_name); assert.equal(body.record.region_id, 4);
  assert.equal(body.record.company_website, null); assert.equal(commits, 1); assert.equal(rollbacks, 0); assert.equal(releases, 1);
  const update = calls.find((call) => call.sql.includes("UPDATE internship_records"));
  assert.match(update.sql, /user_id = \? AND status = 'pending' AND deleted_at IS NULL/);
  assert.deepEqual(update.params.slice(-2), ["record-1", "student-1"]);
  assert.ok(calls.findIndex((call) => call.sql.includes("FOR UPDATE")) < calls.indexOf(update));
  assert.ok(calls.some((call) => call.sql.includes("INSERT INTO activity_logs")));
  assert.ok(!calls.some((call) => /INSERT INTO internship_records|INSERT INTO notifications/.test(call.sql)));
  for (const path of ["/api/v1/internships/all", "/api/v1/internships/my-past-internships", "/api/v1/internship-records/department", "/api/v1/internship-records/overview/record-1", "/api/v1/notifications", "/api/v1/activity-logs"]) assert.equal(cache.has(path), false, path);
  assert.equal(cache.has("/api/v1/departments"), true);
});

test("unauthenticated users, other roles and non-owners cannot edit a record", async (t) => {
  const request = await client(t);
  assert.equal((await request(valid, "student", null)).status, 401);
  for (const role of ["admin", "department_head", "employer"]) assert.equal((await request(valid, role)).status, 403);
  assert.equal((await request(valid, "student", "different-student")).status, 403);
  assert.equal(commits, 0); assert.equal(rollbacks, 1);
  assert.ok(!calls.some((call) => call.sql.includes("UPDATE internship_records")));
});

test("approved, finished, rejected and deleted records cannot be modified", async (t) => {
  const request = await client(t); seedCache();
  for (const status of ["ongoing", "finished", "rejected"]) {
    record.status = status;
    assert.equal((await request()).status, 409);
  }
  record.status = "pending"; record.deleted_at = "2026-10-18";
  assert.equal((await request()).status, 404);
  record = null; assert.equal((await request()).status, 404);
  assert.equal(commits, 0); assert.equal(rollbacks, 5); assert.equal(releases, 5);
  assert.ok(cache.has("/api/v1/internships/all"));
  assert.ok(!calls.some((call) => call.sql.includes("UPDATE internship_records")));
});

test("malformed placement data is rejected before acquiring a database connection", async (t) => {
  const request = await client(t);
  for (const patch of [{ company_name: " " }, { company_name: ["One", "Two"] }, { description: "" }, { date_started: "2026-02-30" }, { date_ended: "2026-01-01" }, { total_hours: "0" }, { total_hours: "Infinity" }, { lat: "91" }, { lon: "-181" }, { lat: "" }, { region_id: "1.5" }, { semester: "3rd" }]) {
    assert.equal((await request({ ...valid, ...patch })).status, 400, JSON.stringify(patch));
  }
  assert.equal(calls.length, 0); assert.equal(releases, 0);
});

test("invalid regions roll back without saving", async (t) => {
  const request = await client(t); validRegion = false;
  assert.equal((await request()).status, 400); assert.equal(commits, 0); assert.equal(rollbacks, 1);
  assert.ok(!calls.some((call) => call.sql.includes("UPDATE internship_records")));
});

test("status, owner, supervisor and accumulated hours are never taken from the request", async (t) => {
  const request = await client(t);
  const response = await request({ ...valid, status: "ongoing", user_id: "attacker", employer_id: "supervisor", accumulated_hours: "999", deleted_at: "2026-01-01" });
  const body = await response.json(); assert.equal(response.status, 200);
  assert.equal(body.record.status, "pending"); assert.equal(body.record.user_id, "student-1");
  assert.equal(body.record.employer_id, null); assert.equal(body.record.accumulated_hours, 0); assert.equal(body.record.deleted_at, null);
  const update = calls.find((call) => call.sql.includes("UPDATE internship_records"));
  assert.doesNotMatch(update.sql.split("WHERE")[0], /status =|user_id =|employer_id|accumulated_hours|deleted_at/);
});

test("a changed row is a conflict and a failed update rolls back without clearing caches", async (t) => {
  const request = await client(t); seedCache(); affectedRows = 0;
  assert.equal((await request()).status, 409); assert.equal(commits, 0); assert.equal(rollbacks, 1);
  affectedRows = 1; failWrite = true;
  const originalError = console.error; console.error = () => {};
  try { assert.equal((await request()).status, 500); } finally { console.error = originalError; }
  assert.equal(commits, 0); assert.equal(rollbacks, 2); assert.equal(releases, 2);
  assert.ok(cache.has("/api/v1/internships/all"));
  assert.ok(!calls.some((call) => call.sql.includes("INSERT INTO activity_logs")));
});
