import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import cache from "../config/cache/cache.js";
import { db } from "../config/db.js";
import { invalidateNotificationsCache } from "../config/cache/notificationsCache.js";
import { requestSupervisor, cancelSupervisorRequest, respondToSupervisorRequest } from "../features/supervisor-requests/controllers/supervisorRequestController.js";
import { deleteStudentEvaluation } from "../features/evaluations/controllers/studentEvaluationControllers.js";

process.env.ACCESS_TOKEN_SECRET = "test-notifications-access";
process.env.REFRESH_TOKEN_SECRET = "test-notifications-refresh";
process.env.TEMP_PASSWORD_SECRET = "test-notifications-temp";
process.env.CACHE_ENABLED = "true";
const { default: routes } = await import("../features/notifications/routes/notificationRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const originalGetConnection = db.getConnection;
const originalExecute = db.execute;
const url = "/api/v1/notifications";
let queries, connection, affectedRows;

beforeEach(() => {
  cache.flushAll(); queries = 0; affectedRows = 1;
  connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, params = []) {
      queries++;
      if (sql.includes("AS unread_count")) return [[{ all_total: 1, request_total: 1, unread_count: 2 }]];
      if (sql.trim().startsWith("SELECT")) return [[{ notification_id: 1, sender_id: "sender", sender_first_name: params[0], type: "supervisor_request_submitted", supervisor_request_status: "pending", is_read: 0 }]];
      return [{ affectedRows }];
    },
  };
  db.getConnection = async () => connection;
  db.execute = (...args) => connection.execute(...args);
});
after(async () => { db.getConnection = originalGetConnection; db.execute = originalExecute; cache.close(); await db.end(); });

async function client(t) {
  const app = express(); app.use("/api/v1", routes);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return (path = url, id = "alice", role = "student", method = "GET") => fetch(
    `http://127.0.0.1:${server.address().port}${path}`,
    { method, headers: id ? { Authorization: `Bearer ${signAccessToken({ id, role })}` } : {} },
  );
}
function seed() {
  for (const [key, userId, path] of [["alice1", "alice", url], ["alice2", "alice", url], ["bob", "bob", url], ["profile", "alice", "/api/v1/account/user"]]) {
    cache.set(key, { userId, path, body: {} });
  }
}
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test("notification GET reuses data, isolates users/page/limit/scope and keeps auth checks", async (t) => {
  const get = await client(t);
  const first = await (await get()).json();
  assert.equal(first.unreadCount, 2); assert.equal(first.data[0].actionable, true);
  assert.deepEqual(await (await get()).json(), first); assert.equal(queries, 2);
  const bob = await (await get(url, "bob")).json(); assert.equal(bob.data[0].sender.first_name, "bob");
  for (const query of ["?page=2", "?limit=20", "?scope=requests"]) assert.equal((await get(url + query)).status, 200);
  assert.equal(queries, 10);
  assert.equal((await get(url, null)).status, 401);
  assert.equal((await get(url, "alice", "invalid-role")).status, 403);
  assert.equal(queries, 10);
});

test("unread-count GET runs only a recipient count and caches it separately", async (t) => {
  const get = await client(t);
  const countUrl = url + "/unread-count";
  const sql = [];
  connection.execute = async (statement, params) => {
    if (statement.trim().startsWith("UPDATE")) return [{ affectedRows: 1 }];
    sql.push({ statement, params });
    return [[{ unread_count: params[0] === "alice" ? 2 : 5 }]];
  };

  assert.deepEqual(await (await get(countUrl)).json(), { unreadCount: 2 });
  assert.deepEqual(await (await get(countUrl)).json(), { unreadCount: 2 });
  assert.deepEqual(await (await get(countUrl, "bob")).json(), { unreadCount: 5 });
  assert.equal(sql.length, 2);
  assert.ok(sql.every(({ statement }) =>
    statement.includes("WHERE user_id = ? AND is_read = 0") &&
    !statement.includes("JOIN") && !statement.includes("LIMIT")));
  assert.equal((await get(countUrl, null)).status, 401);
  assert.equal((await get(countUrl, "alice", "invalid-role")).status, 403);
  assert.equal(sql.length, 2);

  const countKeys = cache.keys().filter((key) =>
    cache.get(key)?.path === countUrl);
  assert.equal(countKeys.length, 2);
  const expiry = cache.getTtl(countKeys[0]);
  assert.ok(expiry > Date.now() + 14000 && expiry <= Date.now() + 15000);

  assert.equal((await get(url + "/1", "alice", "student", "PATCH")).status, 200);
  assert.equal(cache.keys().filter((key) => cache.get(key)?.path === countUrl).length, 1);
  invalidateNotificationsCache();
  assert.equal(cache.keys().length, 0);
});

test("unread-count query errors do not enter the cache", async (t) => {
  const get = await client(t);
  const log = console.error;
  try {
    console.error = () => {};
    connection.execute = async () => { throw new Error("offline"); };
    assert.equal((await get(url + "/unread-count")).status, 500);
    assert.equal(cache.keys().length, 0);
  } finally {
    console.error = log;
  }
});

test("mark-one, mark-all and delete clear all recipient pages without flushing others", async (t) => {
  const call = await client(t);
  for (const [path, method] of [[url + "/1", "PATCH"], [url, "PATCH"], [url + "/1", "DELETE"]]) {
    cache.flushAll(); seed();
    cache.set("alice-count", { userId: "alice", path: url + "/unread-count", body: {} });
    cache.set("bob-count", { userId: "bob", path: url + "/unread-count", body: {} });
    assert.equal((await call(path, "alice", "student", method)).status, 200);
    assert.deepEqual(cache.keys().sort(), ["bob", "bob-count", "profile"]);
  }
});

test("unsuccessful inbox writes preserve caches and errors are not cached", async (t) => {
  const call = await client(t); seed(); affectedRows = 0;
  for (const [path, method] of [[url + "/1", "PATCH"], [url, "PATCH"], [url + "/1", "DELETE"]]) {
    assert.equal((await call(path, "alice", "student", method)).status, 404);
    assert.equal(cache.keys().length, 4);
  }
  cache.flushAll();
  const log = console.error;
  try {
    console.error = () => {};
    connection.execute = async () => { throw new Error("offline"); };
    assert.equal((await call()).status, 500);
    assert.equal(cache.keys().length, 0);
  } finally { console.error = log; }
});

test("cancelled supervisor requests invalidate joined actionable state only after commit", async () => {
  seed();
  connection.execute = async sql => sql.trim().startsWith("SELECT") ? [[{ id: "r", student_id: "alice", status: "pending" }]] : [{ affectedRows: 1 }];
  connection.commit = async () => assert.ok(cache.has("bob"));
  const res = response();
  await cancelSupervisorRequest({ verifiedUser: { id: "alice" }, params: { requestId: "r" } }, res);
  assert.equal(res.statusCode, 200); assert.deepEqual(cache.keys(), ["profile"]);
});

test("new supervisor requests log the company with request and internship IDs kept separately", async () => {
  let activityLog;
  connection.execute = async (sql, params) => {
    if (sql.includes("FROM internship_records")) return [[{ id: 1, employer_id: null, company_name: "Accenture" }]];
    if (sql.includes("FROM user_profiles")) return [[{ first_name: "Alice", last_name: "Student" }]];
    if (sql.includes("INSERT INTO activity_logs")) activityLog = params;
    return [{ affectedRows: 1 }];
  };
  const io = { to: () => ({ emit() {} }) };
  const res = response();
  await requestSupervisor({ verifiedUser: { id: "alice" }, body: { employerId: "bob" }, app: { get: () => io } }, res);
  assert.equal(res.statusCode, 201);
  assert.match(activityLog[5], /Accenture/);
  assert.doesNotMatch(activityLog[5], /internship record 1/);
  assert.equal(activityLog[4], res.body.id);
  assert.equal(JSON.parse(activityLog[6]).internship_id, 1);
});

test("supervisor acceptance/rejection invalidates before socket delivery; rollback preserves cache", async () => {
  const log = console.error;
  try {
    console.error = () => {};
    for (const decision of ["accept", "reject", "failed-commit"]) {
      cache.flushAll(); seed(); let committed = false; let emitted = 0; let activityLog;
      connection.execute = async (sql, params) => {
        if (sql.includes("FROM supervisor_requests")) return [[{ id: "r", student_id: "alice", employer_id: "bob", internship_id: 1, status: "pending" }]];
        if (sql.includes("FROM internship_records")) return [[{ id: 1, status: "ongoing", company_name: "Accenture" }]];
        if (sql.includes("FROM user_profiles")) return [[{ first_name: "Bob", last_name: "Employer" }]];
        if (sql.includes("INSERT INTO activity_logs")) activityLog = params;
        return [{ affectedRows: 1 }];
      };
      connection.commit = async () => { assert.ok(cache.has("bob")); if (decision === "failed-commit") throw new Error("commit failed"); committed = true; };
      const io = { to() { return { emit() { assert.ok(committed); assert.equal(cache.has("bob"), false); emitted++; } }; } };
      const res = response();
      cache.set("searched-supervision",{path:"/api/v1/searched-user/alice",userId:"bob",body:{}});
      await respondToSupervisorRequest({ verifiedUser: { id: "bob" }, params: { requestId: "r" }, body: { decision: decision === "failed-commit" ? "accept" : decision }, app: { get: () => io } }, res);
      assert.equal(res.statusCode, decision === "failed-commit" ? 500 : 200);
      assert.match(activityLog[5], /Accenture/);
      assert.doesNotMatch(activityLog[5], /internship record 1/);
      assert.equal(activityLog[4], "r");
      assert.equal(JSON.parse(activityLog[6]).internship_id, 1);
      assert.equal(emitted, decision === "failed-commit" ? 0 : 1);
      assert.equal(cache.has("bob"), decision === "failed-commit");assert.equal(cache.has("searched-supervision"),decision === "failed-commit");
    }
  } finally { console.error = log; }
});

test("evaluation deletion emits only after commit/invalidation, never on rollback", async () => {
  const log = console.error;
  try {
    console.error = () => {};
    for (const failed of [false, true]) {
      cache.flushAll(); seed(); let committed = false; let emitted = 0;
      connection.execute = async sql => sql.trim().startsWith("SELECT") ? [[{ evaluation_status: "pending", employer_id: "bob", student_id: "alice", internship_id: 1, company: "Company" }]] : [{ affectedRows: 1 }];
      connection.commit = async () => { if (failed) throw new Error("commit failed"); committed = true; };
      const io = { to() { return { emit() { assert.ok(committed); assert.equal(cache.has("alice1"), false); emitted++; } }; } };
      const res = response();
      await deleteStudentEvaluation({ verifiedUser: { id: "admin", role: "admin" }, params: { evaluationId: "evaluation" }, app: { get: () => io } }, res);
      assert.equal(res.statusCode, failed ? 500 : 200);
      assert.equal(emitted, failed ? 0 : 2);
      assert.equal(cache.has("alice1"), failed);
    }
  } finally { console.error = log; }
});

test("notification TTL is 15 seconds and broadcasts clear every inbox", async (t) => {
  const get = await client(t); await get();
  const expiry = cache.getTtl(cache.keys()[0]);
  assert.ok(expiry > Date.now() + 14000 && expiry <= Date.now() + 15000);
  await get(url, "bob"); invalidateNotificationsCache();
  assert.equal(cache.keys().length, 0);
});
