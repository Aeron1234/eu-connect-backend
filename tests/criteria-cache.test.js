import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import cache from "../config/cache.js";
import { db } from "../config/db.js";

process.env.ACCESS_TOKEN_SECRET = "criteria-test-access";
process.env.REFRESH_TOKEN_SECRET = "criteria-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "criteria-test-temp";
process.env.CACHE_ENABLED = "true";
const { default: adminRoutes } = await import("../routes/evaluationsCriteriaRoutes.js");
const { default: employerRoutes } = await import("../routes/employerEvaluationsRoutes.js");
const { default: studentRoutes } = await import("../routes/studentEvaluationRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const originalGetConnection = db.getConnection;
const prefix = "/eu-connect/api/";
const families = [
  { type: "employer", form: "evaluation-criterias", role: "student" },
  { type: "student", form: "student-evaluation/criteria", role: "employer" },
];
const operations = [
  ["", "POST"], ["/1", "DELETE"], ["/1/reactivate", "PATCH"],
  ["/section/Quality", "DELETE"], ["/section/Quality/reactivate", "PATCH"],
];
let connection, calls, active, mode, committed;
beforeEach(() => {
  cache.flushAll(); calls = 0; active = 1; mode = "success"; committed = false;
  connection = {
    async beginTransaction() {}, async rollback() {}, release() {},
    async commit() {
      assert.ok(cache.has("employer-admin")); assert.ok(cache.has("student-admin"));
      if (mode === "commit-failure") throw new Error("commit failed");
      committed = true;
    },
    async execute(sql) {
      calls++;
      if (mode === "db-error") throw new Error("unavailable");
      if (sql.trim().startsWith("SELECT")) {
        if (mode === "missing") return [[]];
        return [[{ id: 1, category: "Quality", criterion_name: "Accuracy", is_active: active }]];
      }
      return [{ affectedRows: mode === "no-write" ? 0 : 1, insertId: 1 }];
    },
  };
  db.getConnection = async () => connection;
});
after(async () => { db.getConnection = originalGetConnection; cache.close(); await db.end(); });

async function client(t) {
  const app = express(); app.use(express.json());
  for (const router of [adminRoutes, employerRoutes, studentRoutes]) app.use(prefix.slice(0, -1), router);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return (path, { id = "admin", role = "admin", method = "GET", body } = {}) => fetch(
    `http://127.0.0.1:${server.address().port}${prefix}${path}`,
    { method, headers: { "Content-Type": "application/json", ...(id ? { Authorization: `Bearer ${signAccessToken({ id, role })}` } : {}) }, body: body ? JSON.stringify(body) : undefined },
  );
}
function seed() {
  for (const family of families) {
    for (const [suffix, route] of [["admin", `criteria/${family.type}-evaluation`], ["inactive", `criteria/${family.type}-evaluation`], ["form", family.form]]) {
      cache.set(family.type + "-" + suffix, { userId: suffix, path: prefix + route, body: [] });
    }
  }
  cache.set("profile", { userId: "admin", path: prefix + "account/user", body: {} });
}

test("all four criteria reads cache for five minutes with unchanged response shapes", async (t) => {
  const get = await client(t);
  for (const family of families) {
    const admin = `criteria/${family.type}-evaluation`;
    const first = await (await get(admin)).json();
    assert.deepEqual(first, [{ category: "Quality", items: [{ id: 1, name: "Accuracy", is_active: true }] }]);
    const before = calls; assert.deepEqual(await (await get(admin)).json(), first); assert.equal(calls, before);
    const form = await (await get(family.form, { role: family.role })).json();
    assert.deepEqual(form, [{ category: "Quality", items: [{ id: "Accuracy", db_id: 1, name: "Accuracy" }] }]);
    const formCalls = calls; await get(family.form, { role: family.role }); assert.equal(calls, formCalls);
  }
  for (const key of cache.keys()) { const ttl = cache.getTtl(key) - Date.now(); assert.ok(ttl > 295000 && ttl <= 300000); }
});

test("inactive variants and users stay separate, with authorization before cache", async (t) => {
  const get = await client(t); const route = "criteria/student-evaluation";
  await get(route); active = 0;
  const inactive = await (await get(route + "?includeInactive=true")).json();
  assert.equal(inactive[0].items[0].is_active, false); assert.equal(calls, 2);
  await get(route, { id: "admin2" }); assert.equal(calls, 3);
  assert.equal((await get(route, { role: "student" })).status, 403);
  assert.equal((await get(route, { id: null })).status, 401);
  assert.equal((await get("student-evaluation/criteria", { role: "student" })).status, 403);
  assert.equal(calls, 3);
});

test("all ten writes invalidate admin variants and active forms after commit", async (t) => {
  const call = await client(t);
  for (const family of families) for (const [suffix, method] of operations) {
    cache.flushAll(); seed(); active = suffix.endsWith("reactivate") ? 0 : 1; committed = false;
    const res = await call(`criteria/${family.type}-evaluation${suffix}`, { method, body: { category: "Quality", criterion_name: "Accuracy" } });
    assert.equal(res.status, method === "POST" ? 201 : 200); assert.ok(committed);
    for (const variant of ["admin", "inactive", "form"]) assert.equal(cache.has(family.type + "-" + variant), false);
    const other = family.type === "employer" ? "student" : "employer";
    assert.ok(cache.has(other + "-admin")); assert.ok(cache.has(other + "-form")); assert.ok(cache.has("profile"));
  }
});

test("failed commits across all ten writes preserve both families", async (t) => {
  const call = await client(t); const log = console.error;
  try {
    console.error = () => {}; mode = "commit-failure";
    for (const family of families) for (const [suffix, method] of operations) {
      cache.flushAll(); seed(); active = suffix.endsWith("reactivate") ? 0 : 1;
      const res = await call(`criteria/${family.type}-evaluation${suffix}`, { method, body: { category: "Quality", criterion_name: "Accuracy" } });
      assert.equal(res.status, 500); assert.equal(cache.keys().length, 7);
    }
  } finally { console.error = log; }
});

test("missing/unchanged criteria and invalid input do not invalidate", async (t) => {
  const call = await client(t); seed();
  const base = "criteria/student-evaluation";
  assert.equal((await call(base, { method: "POST", body: {} })).status, 400);
  mode = "missing";
  assert.equal((await call(base + "/1", { method: "DELETE" })).status, 404);
  assert.equal((await call(base + "/section/Quality/reactivate", { method: "PATCH" })).status, 404);
  mode = "success"; active = 0;
  assert.equal((await call(base + "/1", { method: "DELETE" })).status, 400);
  active = 1;
  assert.equal((await call(base + "/1/reactivate", { method: "PATCH" })).status, 400);
  assert.equal(cache.keys().length, 7);
});

test("read errors are not cached and empty results are cached", async (t) => {
  const get = await client(t); const log = console.error;
  try {
    console.error = () => {}; mode = "db-error";
    assert.equal((await get("criteria/employer-evaluation")).status, 500); assert.equal(cache.keys().length, 0);
  } finally { console.error = log; }
  mode = "missing";
  assert.deepEqual(await (await get("criteria/employer-evaluation")).json(), []);
  const before = calls; await get("criteria/employer-evaluation"); assert.equal(calls, before);
});
