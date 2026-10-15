import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import cache from "../config/cache/cache.js";
import { db } from "../config/db.js";

process.env.ACCESS_TOKEN_SECRET = "lookup-test-access";
process.env.REFRESH_TOKEN_SECRET = "lookup-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "lookup-test-temp";
process.env.CACHE_ENABLED = "true";
const { default: routes } = await import("../features/departments-and-courses/routes/departmentsAndCoursesRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const originalGetConnection = db.getConnection;
const originalExecute = db.execute;
const prefix = "/eu-connect/api/";
let calls, rows, connection, committed, mode;

beforeEach(() => {
  cache.flushAll(); calls = 0; committed = false; mode = "success";
  rows = [{ id: 1, is_active: 1 }];
  db.execute = async () => { calls++; return [structuredClone(rows)]; };
  connection = {
    async beginTransaction() {}, async rollback() {}, release() {},
    async commit() {
      assert.ok(cache.has("form"), "form must remain cached until commit succeeds");
      if (mode === "commit-failure") throw new Error("commit failed");
      committed = true;
    },
    async execute(sql) {
      if (sql.includes("WHERE code =") || sql.includes("WHERE short_name =")) return [mode === "duplicate" ? [{ id: 1 }] : []];
      if (sql.trim().startsWith("SELECT")) return [mode === "missing" ? [] : rows];
      return [{ affectedRows: 1, insertId: 1 }];
    },
  };
  db.getConnection = async () => connection;
});
after(async () => { db.getConnection = originalGetConnection; db.execute = originalExecute; cache.close(); await db.end(); });

async function client(t) {
  const app = express(); app.use(express.json()); app.use(prefix.slice(0, -1), routes);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return (path, { id = "alice", role = "student", method = "GET", body } = {}) => fetch(
    `http://127.0.0.1:${server.address().port}${prefix}${path}`,
    { method, headers: { "Content-Type": "application/json", ...(id ? { Authorization: `Bearer ${signAccessToken({ id, role })}` } : {}) }, body: body ? JSON.stringify(body) : undefined },
  );
}
function seed() {
  for (const [key, path] of [["courses-a", "courses"], ["courses-b", "courses"], ["departments-a", "departments"], ["departments-b", "departments"], ["form", "create-account-form-data"], ["profile", "account/user"]]) {
    cache.set(key, { userId: key, path: prefix + path, body: {} });
  }
}

test("lookup GETs cache for five minutes and keep user/query variants separate", async (t) => {
  const get = await client(t);
  for (const route of ["courses", "departments"]) {
    const first = await get(route); assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await first.json(), rows);
    const before = calls; await get(route); assert.equal(calls, before);
    await get(route, { id: "bob" }); await get(route + "?variant=1");
    assert.equal(calls, before + 2);
  }
  for (const key of cache.keys()) {
    const ttl = cache.getTtl(key) - Date.now(); assert.ok(ttl > 295000 && ttl <= 300000);
  }
});

test("cached lists still enforce existing role permissions", async (t) => {
  const get = await client(t);
  await get("departments"); const before = calls;
  assert.equal((await get("departments", { role: "employer" })).status, 403);
  assert.equal((await get("departments", { id: null })).status, 401);
  assert.equal((await get("courses", { role: "unknown" })).status, 403);
  assert.equal(calls, before);
  assert.equal((await get("courses", { role: "employer" })).status, 200);
  assert.equal((await get("courses/1/activate", { method: "PATCH" })).status, 403);
});

test("all six successful writes clear all affected users and account form after commit", async (t) => {
  const call = await client(t);
  for (const table of ["departments", "courses"]) {
    for (const operation of ["new", "activate", "deactivate"]) {
      cache.flushAll(); seed(); committed = false;
      rows = [{ id: 1, is_active: operation === "activate" ? 0 : 1 }];
      const res = await call(table + (operation === "new" ? "" : `/1/${operation}`), {
        role: "admin", method: operation === "new" ? "POST" : "PATCH",
        body: { name: "Computing", code: "IT", course_name: "Computing", short_name: "CS", department_id: 1 },
      });
      assert.equal(res.status, operation === "new" ? 201 : 200); assert.ok(committed);
      assert.equal(cache.has(table + "-a"), false); assert.equal(cache.has(table + "-b"), false);
      assert.equal(cache.has("form"), false); assert.equal(cache.has("profile"), true);
      assert.equal(cache.has((table === "courses" ? "departments" : "courses") + "-a"), true);
    }
  }
});

test("failed, duplicate, missing and unchanged writes preserve cached data", async (t) => {
  const call = await client(t); const log = console.error;
  try {
    console.error = () => {};
    for (const table of ["departments", "courses"]) {
      for (const failure of ["duplicate", "missing", "unchanged", "commit-failure"]) {
        cache.flushAll(); seed(); mode = failure;
        rows = [{ id: 1, is_active: failure === "unchanged" ? 0 : 1 }];
        const create = failure === "duplicate";
        const res = await call(table + (create ? "" : "/1/deactivate"), {
          role: "admin", method: create ? "POST" : "PATCH",
          body: { name: "Computing", code: "IT", course_name: "Computing", short_name: "CS", department_id: 1 },
        });
        assert.equal(res.status, { duplicate: 409, missing: 404, unchanged: 400, "commit-failure": 500 }[failure]);
        assert.equal(cache.keys().length, 6);
      }
    }
  } finally { console.error = log; }
});

test("database errors are not cached and empty lookup results are cached", async (t) => {
  const get = await client(t); const execute = db.execute; const log = console.error;
  try {
    console.error = () => {}; db.execute = async () => { throw new Error("offline"); };
    assert.equal((await get("courses")).status, 500); assert.equal(cache.keys().length, 0);
  } finally { db.execute = execute; console.error = log; }
  rows = []; assert.deepEqual(await (await get("courses")).json(), []);
  const before = calls; await get("courses"); assert.equal(calls, before);
});
