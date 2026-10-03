import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import cache from "../config/cache.js";
import { db } from "../config/db.js";
import * as announcements from "../controllers/announcementControllers.js";
import { updateUserInfo } from "../controllers/accountControllers.js";
import { invalidateAnnouncementCategoriesCache } from "../config/announcementsCache.js";

process.env.ACCESS_TOKEN_SECRET = "announcements-test-access";
process.env.REFRESH_TOKEN_SECRET = "announcements-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "announcements-test-temp";
process.env.CACHE_ENABLED = "true";
const { default: routes } = await import("../routes/announcementRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const originalExecute = db.execute;
const originalGetConnection = db.getConnection;
const base = "/eu-connect/api/announcements/";
let calls, connection, mode, pinned, categoryName, committed, emitted, fixtures, activityLog;
beforeEach(() => {
  cache.flushAll(); calls = 0; mode = "success"; pinned = false;
  categoryName = "General"; committed = false; emitted = 0; activityLog = null;
  fixtures = [
    { id: 1, category: "General", department: null, is_pinned: true, title: "General" },
    { id: 2, category: "Department", department: 1, is_pinned: false, title: "Dept one" },
    { id: 3, category: "Department", department: 2, is_pinned: false, title: "Dept two" },
  ];
  db.execute = async (sql, params = []) => {
    calls++;
    if (mode === "read-error") throw new Error("read unavailable");
    if (sql.includes("SELECT * FROM announcement_categories")) return [mode === "empty" ? [] : [{ id: 1, name: "General" }]];
    assert.ok(sql.includes("authorDept.department_id = ?"));
    const regular = sql.includes("LIMIT ? OFFSET ?");
    const filters = regular ? params.slice((params.length - 2) / 2, -2) : params;
    const [role, duplicateRole, department] = filters.slice(-3);
    assert.equal(duplicateRole, role);
    let rows = mode === "empty" ? [] : fixtures.filter(row => row.category !== "Department" || (role !== "employer" && (role === "admin" || row.department === department)));
    let index = 0;
    if (sql.includes("ac.name = ?")) { const category = filters[index++]; rows = rows.filter(row => row.category === category); }
    if (sql.includes("a.title LIKE ?")) { const search = filters[index].replaceAll("%", ""); rows = rows.filter(row => row.title.includes(search)); }
    const count = sql.trim().startsWith("SELECT COUNT(*) AS total");
    rows = rows.filter(row => row.is_pinned === (!regular && !count));
    if (count) return [[{ total: rows.length }]];
    if (regular) {
      const total = rows.length;
      rows = rows.slice(params.at(-1), params.at(-1) + params.at(-2))
        .map(row => ({ ...row, total_regular: total }));
    }
    return [structuredClone(rows)];
  };
  connection = {
    async beginTransaction() {}, async rollback() {}, release() {},
    async commit() {
      assert.ok(cache.has("feed-a"), "feed must remain cached before commit");
      if (mode === "commit-failure") throw new Error("commit failed");
      committed = true;
    },
    async query() { return [{ affectedRows: 1 }]; },
    async execute(sql, params) {
      if (sql.includes("INSERT INTO activity_logs")) activityLog = params;
      if (sql.includes("FROM user_profiles")) return [[{ first_name: "Author", last_name: "Name" }]];
      if (sql.includes("SELECT name FROM announcement_categories")) return [mode === "invalid-category" ? [] : [{ name: categoryName }]];
      if (sql.includes("FROM announcements a") && sql.includes("FOR UPDATE")) return [mode === "forbidden" ? [] : [{ category_id: 1, category_name: "General", title: "Old" }]];
      if (sql.includes("SELECT title FROM announcements")) return [[{ title: "Old" }]];
      if (sql.includes("SELECT a.*")) return [[{ id: 1, title: "New", first_name: "Author", last_name: "Name", category: categoryName }]];
      if (sql.includes("FROM dept_heads_background_info")) return [[{ department_id: 1 }]];
      if (sql.includes("SELECT id, email, username FROM users")) return [[{ id: "author", email: "author@example.test", username: "author" }]];
      if (sql.trim().startsWith("SELECT")) return [[{ id: "recipient" }]];
      return [{ affectedRows: mode === "no-write" ? 0 : 1, insertId: 1 }];
    },
  };
  db.getConnection = async () => connection;
});
after(async () => { db.execute = originalExecute; db.getConnection = originalGetConnection; cache.close(); await db.end(); });
async function client(t) {
  const app = express(); app.use("/eu-connect/api", routes);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return (path = "history", role = "student", department_id = 1, id = "viewer") => fetch(`http://127.0.0.1:${server.address().port}${base}${path}`, {
    headers: id ? { Authorization: `Bearer ${signAccessToken({ id, role, department_id })}` } : {},
  });
}
function seed() {
  for (const [key, path] of [["feed-a", "history"], ["feed-b", "history"], ["categories", "categories"]]) cache.set(key, { userId: key, path: base + path, body: {} });
  cache.set("profile", { userId: "other", path: "/eu-connect/api/account/user", body: {} });
}
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function request(data = {}) {
  return { verifiedUser: { id: "author", role: "department_head" }, params: { announcementId: 1 },
    body: { category_id: 1, title: "New", content: "Content", is_pinned: pinned, ...data },
    app: { get: () => ({ to: () => ({ emit: () => { assert.ok(committed); assert.equal(cache.has("feed-a"), false); emitted++; } }) }) } };
}

test("feed caches for 30 seconds and categories for five minutes", async (t) => {
  const get = await client(t);
  for (const [path, ttl, queries] of [["history", 30000, 2], ["categories", 300000, 1]]) {
    const before = calls; const first = await get(path); assert.equal(first.status, 200);
    const body = await first.json(); assert.deepEqual(await (await get(path)).json(), body); assert.equal(calls, before + queries);
    const key = cache.keys().find(key => cache.get(key).path === base + path);
    const remaining = cache.getTtl(key) - Date.now(); assert.ok(remaining > ttl - 5000 && remaining <= ttl);
  }
});

test("role, user and department keys preserve announcement visibility on hits", async (t) => {
  const get = await client(t);
  for (const [role, department, ids] of [["student", 1, [2]], ["student", 2, [3]], ["department_head", 1, [2]], ["employer", 1, []], ["admin", 1, [2, 3]]]) {
    const path = "history?category=Department";
    const first = await (await get(path, role, department)).json(); assert.deepEqual(first.regular.map(row => row.id), ids);
    const before = calls; assert.deepEqual(await (await get(path, role, department)).json(), first); assert.equal(calls, before);
  }
  const before = calls; await get("history?category=Department", "student", 1, "other"); assert.equal(calls, before + 2);
  assert.equal((await get("history", "unknown")).status, 403); assert.equal((await get("categories", "student", 1, null)).status, 401);
});

test("search/category/page variants remain separate, including pinned and regular data", async (t) => {
  const get = await client(t);
  for (const [path, queries] of [["history", 2], ["history?page=2", 3], ["history?search=Dept", 2], ["history?category=General", 3], ["history?category=Department", 2]]) {
    const before = calls; const res = await get(path); assert.equal(res.status, 200); assert.equal(calls, before + queries);
    const data = await res.json(); assert.ok(Array.isArray(data.pinned)); assert.ok(Array.isArray(data.regular));
    await get(path); assert.equal(calls, before + queries);
  }
});

test("create/edit/delete/pin/unpin clear all feeds after commit and before notifications", async () => {
  for (const [handler, isPinned] of [[announcements.createAnnouncement, false], [announcements.updateAnnouncement, false], [announcements.deleteAnnouncement, false], [announcements.togglePinAnnouncement, true], [announcements.togglePinAnnouncement, false]]) {
    cache.flushAll(); seed(); committed = false; pinned = isPinned; const res = response(); await handler(request(), res);
    assert.ok(res.statusCode < 300); assert.ok(committed); assert.equal(cache.has("feed-a"), false); assert.equal(cache.has("feed-b"), false);
    assert.ok(cache.has("categories")); assert.ok(cache.has("profile"));
  }
  assert.equal(emitted, 1);
});

test("announcement edits and deletes log the persisted title while keeping the target ID", async () => {
  for (const [handler, expected] of [
    [announcements.updateAnnouncement, 'announcement "New"'],
    [announcements.deleteAnnouncement, 'announcement "Old"'],
  ]) {
    seed();
    const res = response();
    await handler(request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(activityLog[4], "1");
    assert.ok(activityLog[5].includes(expected));
    assert.ok(!activityLog[5].includes("announcement 1"));
    cache.flushAll();
  }
});

test("general-to-department edit evicts previously visible content before socket refresh", async () => {
  seed(); categoryName = "Department"; const res = response();
  await announcements.updateAnnouncement(request({ category_id: 2 }), res);
  assert.equal(res.statusCode, 200); assert.equal(cache.has("feed-a"), false); assert.equal(emitted, 1);
});

test("failed commits preserve feeds and do not emit notification events", async () => {
  const error = console.error; const log = console.log;
  try {
    console.error = () => {}; console.log = () => {}; mode = "commit-failure";
    for (const handler of [announcements.createAnnouncement, announcements.updateAnnouncement, announcements.deleteAnnouncement, announcements.togglePinAnnouncement]) {
      cache.flushAll(); seed(); const res = response(); await handler(request(), res);
      assert.equal(res.statusCode, 500); assert.equal(cache.keys().length, 4); assert.equal(emitted, 0);
    }
  } finally { console.error = error; console.log = log; }
});

test("rejected writes leave cached feeds intact", async () => {
  for (const [handler, failure, status] of [[announcements.createAnnouncement, "invalid-category", 400], [announcements.updateAnnouncement, "forbidden", 403], [announcements.deleteAnnouncement, "no-write", 404], [announcements.togglePinAnnouncement, "no-write", 404]]) {
    cache.flushAll(); seed(); mode = failure; const res = response(); await handler(request(), res);
    assert.equal(res.statusCode, status); assert.ok(cache.has("feed-a")); assert.equal(committed, false);
  }
});

test("profile-name writes invalidate joined author names only after commit", async () => {
  const error = console.error;
  try {
    console.error = () => {};
    for (const failed of [false, true]) {
      cache.flushAll(); seed(); mode = failed ? "commit-failure" : "success"; const res = response();
      cache.set("hte-profile", {path:"/eu-connect/api/reports/hte-annual/companies",userId:"admin",body:{}});
      cache.set("staff-profile",{path:"/eu-connect/api/internship-records/department",userId:"head",body:{}});
      cache.set("evaluation-profile",{path:"/eu-connect/api/evaluations/all",userId:"student",body:[]});
      cache.set("searched-profile",{path:"/eu-connect/api/searched-user/student",userId:"staff",body:{}});
      await updateUserInfo(request({ first_name: "Renamed" }), res);
      assert.equal(cache.has("searched-profile"),failed);
      assert.equal(cache.has("evaluation-profile"),failed);
      assert.equal(cache.has("staff-profile"),failed);
      assert.equal(cache.has("hte-profile"), failed);
      assert.equal(res.statusCode, failed ? 500 : 200); assert.equal(cache.has("feed-a"), failed); assert.ok(cache.has("categories"));
    }
  } finally { console.error = error; }
});

test("category invalidation clears both joined feed data and category lookups", () => {
  seed(); invalidateAnnouncementCategoriesCache(); assert.deepEqual(cache.keys(), ["profile"]);
});

test("failed reads are not cached; null categories and empty feeds are cached", async (t) => {
  const get = await client(t); const error = console.error; const log = console.log;
  try {
    console.error = () => {}; console.log = () => {}; mode = "read-error";
    for (const path of ["history", "categories"]) assert.equal((await get(path)).status, 500);
    assert.equal(cache.keys().length, 0);
  } finally { console.error = error; console.log = log; }
  mode = "empty";
  assert.equal(await (await get("categories")).json(), null);
  assert.deepEqual((await (await get("history")).json()).regular, []);
  const before = calls; await get("history"); await get("categories"); assert.equal(calls, before);
});
