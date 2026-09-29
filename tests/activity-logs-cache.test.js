import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import cache from "../config/cache.js";
import { db } from "../config/db.js";
import { invalidateActivityLogsCache } from "../config/activityLogsCache.js";
import { deleteActivityLog } from "../controllers/activityLogsControllers.js";
import { deactivateAccount } from "../controllers/accountControllers.js";

process.env.ACCESS_TOKEN_SECRET = "test-only-access-secret";
process.env.REFRESH_TOKEN_SECRET = "test-only-refresh-secret";
process.env.TEMP_PASSWORD_SECRET = "test-only-temp-secret";
process.env.CACHE_ENABLED = "true";
const { default: routes } = await import("../routes/activityLogsRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const originalGetConnection = db.getConnection;
const base = "/eu-connect/api/activity-logs";
let queries;
let connection;

beforeEach(() => {
  cache.flushAll(); queries = 0;
  connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, params = []) {
      queries++;
      if (sql.includes("COUNT(*)")) return [[{ total: 1 }]];
      if (sql.includes("DISTINCT")) return [[]];
      if (sql.includes("FOR UPDATE")) return [[{ id: 1, actor_id: "alice" }]];
      if (sql.trim().startsWith("SELECT")) return [[{ id: 1, actor_id: params[0] || "alice", description: "activity" }]];
      return [{ affectedRows: 1 }];
    },
  };
  db.getConnection = async () => connection;
});
after(async () => { db.getConnection = originalGetConnection; cache.close(); await db.end(); });

async function client(t) {
  const app = express();
  app.use("/eu-connect/api", routes);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return (path, id = "alice", role = "student", method = "GET") => fetch(
    `http://127.0.0.1:${server.address().port}${path}`,
    { method, headers: id ? { Authorization: `Bearer ${signAccessToken({ id, role })}` } : {} },
  );
}

function seed() {
  for (const [key, path] of [["mine1", base + "/mine"], ["mine2", base + "/mine"], ["admin1", base], ["admin2", base], ["profile", "/eu-connect/api/account/user"]]) {
    cache.set(key, { userId: key, path, body: {} });
  }
}
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test("personal log route caches reads and isolates users and pages", async (t) => {
  const get = await client(t);
  assert.equal((await get(base + "/mine?page=1")).status, 200);
  assert.equal(queries, 2);
  assert.equal((await get(base + "/mine?page=1")).status, 200);
  assert.equal(queries, 2);
  const bob = await (await get(base + "/mine?page=1", "bob")).json();
  assert.equal(bob.data[0].actor_id, "bob");
  assert.equal(queries, 4);
  await get(base + "/mine?page=2");
  assert.equal(queries, 6);
});

test("admin log route caches filters but still enforces authentication and role", async (t) => {
  const get = await client(t);
  await get(base + "?action=created", "admin", "admin");
  assert.equal(queries, 5);
  await get(base + "?action=created", "admin", "admin");
  assert.equal(queries, 5);
  assert.equal((await get(base + "?action=created", "admin", "student")).status, 403);
  assert.equal((await get(base + "?action=created", null)).status, 401);
  assert.equal(queries, 5);
  await get(base + "?action=deleted", "admin", "admin");
  assert.equal(queries, 10);
});

test("committed log deletion clears both views and leaves unrelated caches", async (t) => {
  const get = await client(t);
  seed();
  connection.commit = async () => assert.ok(cache.has("mine1"));
  assert.equal((await get(base + "/1", "admin", "admin", "DELETE")).status, 200);
  assert.deepEqual(cache.keys(), ["profile"]);
});

test("missing logs, forbidden deletes and failed commits preserve caches", async () => {
  const log = console.error;
  try {
    console.error = () => {};
    for (const mode of ["missing", "forbidden", "commit-failure"]) {
      cache.flushAll(); seed();
      connection.execute = async () => [mode === "missing" ? [] : [{ id: 1, actor_id: "alice" }]];
      connection.commit = async () => { if (mode === "commit-failure") throw new Error("failed commit"); };
      const res = response();
      await deleteActivityLog({ verifiedUser: { id: "bob", role: mode === "forbidden" ? "student" : "admin" }, params: { logId: 1 } }, res);
      assert.equal(res.statusCode, { missing: 404, forbidden: 403, "commit-failure": 500 }[mode]);
      assert.equal(cache.keys().length, 5);
    }
  } finally { console.error = log; }
});

test("a log created by another controller invalidates cached lists after commit", async () => {
  seed();
  connection.commit = async () => assert.ok(cache.has("admin1"));
  const res = response();
  await deactivateAccount({ verifiedUser: { id: "admin", role: "admin" }, params: { accountId: "alice" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(cache.keys(), ["profile"]);
});

test("invalidation refreshes subsequent reads; errors never populate cache", async (t) => {
  const get = await client(t);
  await get(base + "/mine");
  invalidateActivityLogsCache();
  await get(base + "/mine");
  assert.equal(queries, 4);
  cache.flushAll();
  const execute = connection.execute;
  const log = console.error;
  try {
    console.error = () => {};
    connection.execute = async () => { throw new Error("database unavailable"); };
    assert.equal((await get(base + "/mine")).status, 500);
    assert.equal(cache.keys().length, 0);
  } finally { connection.execute = execute; console.error = log; }
  assert.equal((await get(base + "/mine")).status, 200);
});
