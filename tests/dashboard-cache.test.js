import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import cache from "../config/cache.js";
import { db } from "../config/db.js";
import { deleteDTR } from "../controllers/dtrControllers.js";
import { invalidateActivityLogsCache } from "../config/activityLogsCache.js";
import { invalidateNotificationsCache } from "../config/notificationsCache.js";
import { invalidatePostingFavoritesCache } from "../config/postingsCache.js";
import { invalidateCriteriaCache } from "../config/criteriaCache.js";

process.env.ACCESS_TOKEN_SECRET = "dashboard-test-access";
process.env.REFRESH_TOKEN_SECRET = "dashboard-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "dashboard-test-temp";
process.env.MAX_SHIFT_HOURS = "8";
process.env.BATCH_SIZE = "100";
process.env.CACHE_ENABLED = "true";
const { default: routes } = await import("../routes/dashboardRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const { autoCloseStaleShifts } = await import("../config/autoCloseStaleShifts.js");
const originalGetConnection = db.getConnection;
const prefix = "/eu-connect/api/";
const targets = [
  ["dashboard-stats", "student"], ["employer-dashboard-stats", "employer"],
  ["employer-dashboard-data", "employer"], ["department-head-dashboard-stats", "department_head"],
  ["department-head-dashboard-data", "department_head"], ["average-shift-hours", "department_head"],
  ["admin-dashboard-stats", "admin"], ["admin-dashboard-data", "admin"],
];
let connection, calls, failCommit;
beforeEach(() => {
  cache.flushAll(); calls = 0; failCommit = false;
  connection = {
    async beginTransaction() {}, async rollback() {}, release() {},
    async commit() { assert.ok(cache.has("alice")); if (failCommit) throw new Error("failed commit"); },
    async query() { return [{ affectedRows: 1 }]; },
    async execute(sql) {
      calls++;
      if (sql.includes("COUNT(*)")) return [[{ count: 1, total: 1 }]];
      if (sql.trim().startsWith("SELECT")) return [[]];
      return [{ affectedRows: 1 }];
    },
  };
  db.getConnection = async () => connection;
});
after(async () => { db.getConnection = originalGetConnection; cache.close(); await db.end(); });
async function client(t) {
  const app = express(); app.use(prefix.slice(0, -1), routes);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return (path, role, id = "alice", department_id = 1) => fetch(`http://127.0.0.1:${server.address().port}${prefix}${path}`, {
    headers: id ? { Authorization: `Bearer ${signAccessToken({ id, role, department_id })}` } : {},
  });
}
function seed() {
  for (const id of ["alice", "bob"]) cache.set(id, { userId: id, path: prefix + "dashboard-stats", body: {} });
  cache.set("profile", { userId: "alice", path: prefix + "account/user", body: {} });
}
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

test("all eight summaries cache successful responses for fifteen seconds", async (t) => {
  const get = await client(t);
  for (const [path, role] of targets) {
    const first = await get(path, role); assert.equal(first.status, 200, path);
    const body = await first.json(); const before = calls;
    assert.deepEqual(await (await get(path, role)).json(), body); assert.equal(calls, before, path);
  }
  assert.equal(cache.keys().length, 8);
  for (const key of cache.keys()) { const ttl = cache.getTtl(key) - Date.now(); assert.ok(ttl > 10000 && ttl <= 15000); }
});

test("summary caches isolate user, department and month, and retain authorization", async (t) => {
  const get = await client(t);
  for (const [path, role] of targets) {
    await get(path, role); const before = calls;
    await get(path, role, "bob"); assert.ok(calls > before);
    assert.equal((await get(path, "unknown")).status, 403);
    assert.equal((await get(path, role, null)).status, 401);
  }
  let before = calls; await get("department-head-dashboard-stats", "department_head", "alice", 2); assert.ok(calls > before);
  before = calls; await get("average-shift-hours?month=1&year=2026", "department_head"); assert.ok(calls > before);
});

test("live student attendance overview stays uncached", async (t) => {
  const get = await client(t);
  await get("student-dashboard-data", "student"); const before = calls;
  await get("student-dashboard-data", "student"); assert.ok(calls > before); assert.equal(cache.keys().length, 0);
});

test("partial overview failures return existing fallback responses without caching", async (t) => {
  const get = await client(t); const execute = connection.execute; const log = console.error;
  try {
    console.error = () => {};
    connection.execute = async () => { calls++; throw new Error("query unavailable"); };
    for (const [path, role] of targets.filter(([path]) => path.endsWith("-data"))) {
      const first = await get(path, role); assert.equal(first.status, 200);
      const before = calls; await get(path, role); assert.ok(calls > before);
    }
    assert.equal(cache.keys().length, 0);
    assert.equal((await get("dashboard-stats", "student")).status, 500);
    assert.equal(cache.keys().length, 0);
  } finally { connection.execute = execute; console.error = log; }
});

test("shared writes invalidate summaries while personal counter changes target one user", () => {
  for (const invalidate of [invalidateActivityLogsCache, () => invalidateCriteriaCache("student_evaluation_criteria")]) {
    cache.flushAll(); seed(); invalidate(); assert.deepEqual(cache.keys(), ["profile"]);
  }
  for (const invalidate of [invalidateNotificationsCache, invalidatePostingFavoritesCache]) {
    cache.flushAll(); seed(); invalidate("alice"); assert.deepEqual(cache.keys().sort(), ["bob", "profile"]);
  }
});

test("attendance deletion invalidates only after successful commit", async () => {
  const log = console.log;
  try {
    console.log = () => {};
    for (const fail of [false, true]) {
      cache.flushAll(); seed(); failCommit = fail; const res = response();
      cache.set("overview-hours",{path:"/eu-connect/api/internship-records/overview/i",userId:"staff",body:{}});
      cache.set("attendance-history",{path:"/eu-connect/api/dtr/history",userId:"student",body:{}});
      cache.set("staff-hours",{path:"/eu-connect/api/internship-records/department",userId:"head",body:{}});
      await deleteDTR({ verifiedUser: { id: "alice" }, params: { dtrId: 1 } }, res);
      assert.equal(cache.has("staff-hours"),fail);assert.equal(cache.has("attendance-history"),fail);assert.equal(cache.has("overview-hours"),fail);
      assert.equal(res.statusCode, fail ? 500 : 200); assert.equal(cache.has("alice"), fail); assert.ok(cache.has("profile"));
    }
  } finally { console.log = log; }
});

test("stale-shift cron clears summary caches after commit but preserves them on rollback", async () => {
  const log = console.log; const error = console.error;
  try {
    console.log = () => {}; console.error = () => {};
    connection.execute = async () => [[{ id: 1, internship_id: 1 }]];
    for (const fail of [false, true]) {
      cache.flushAll(); seed(); failCommit = fail;
      cache.set("overview-hours",{path:"/eu-connect/api/internship-records/overview/i",userId:"staff",body:{}});
      cache.set("attendance-history",{path:"/eu-connect/api/dtr/history",userId:"student",body:{}});
      cache.set("staff-hours",{path:"/eu-connect/api/internship-records/department",userId:"head",body:{}});
      await autoCloseStaleShifts(); assert.equal(cache.has("staff-hours"),fail);assert.equal(cache.has("attendance-history"),fail);assert.equal(cache.has("overview-hours"),fail); assert.equal(cache.has("alice"), fail); assert.ok(cache.has("profile"));
    }
  } finally { console.log = log; console.error = error; }
});
