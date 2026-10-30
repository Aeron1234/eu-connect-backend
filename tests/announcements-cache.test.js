import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import cache from "../config/cache/cache.js";
import { db } from "../config/db.js";
import * as announcements from "../features/announcements/controllers/announcementControllers.js";
import { updateUserInfo } from "../features/accounts/controllers/accountControllers.js";
import { invalidateAnnouncementCategoriesCache } from "../config/cache/announcementsCache.js";

process.env.ACCESS_TOKEN_SECRET = "announcements-test-access";
process.env.REFRESH_TOKEN_SECRET = "announcements-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "announcements-test-temp";
process.env.CACHE_ENABLED = "true";
const { default: routes } = await import("../features/announcements/routes/announcementRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const originalExecute = db.execute;
const originalGetConnection = db.getConnection;
const base = "/api/v1/announcements/";
const announcementId = "73cd551e-c61f-4fd8-9628-d69709b77d52";
let calls, connection, mode, pinned, categoryName, committed, emitted, fixtures, activityLog, announcementWrite;
let existingEventDates;
beforeEach(() => {
  cache.flushAll(); calls = 0; mode = "success"; pinned = false;
  categoryName = "General"; committed = false; emitted = 0; activityLog = null; announcementWrite = null;
  existingEventDates = { event_date: null, event_end_date: null };
  fixtures = [
    { id: 1, public_id: "41038a27-bc63-4506-9c4f-20ffbe88396c", category: "General", department: null, is_pinned: true, title: "General" },
    { id: 2, public_id: "e531092e-4d22-4e1b-b909-e89d2c6ac3ea", category: "Department", department: 1, is_pinned: false, title: "Dept one" },
    { id: 3, public_id: "16114ec0-55ef-463a-9f6f-9ad7f7cb9682", category: "Department", department: 2, is_pinned: false, title: "Dept two" },
  ];
  db.execute = async (sql, params = []) => {
    calls++;
    if (mode === "read-error") throw new Error("read unavailable");
    if (sql.includes("SELECT * FROM announcement_categories")) return [mode === "empty" ? [] : [{ id: 1, name: "General" }]];
    if (sql.includes("LIMIT 1") && (sql.includes("WHERE a.public_id = ?") || sql.includes("WHERE a.id = ?"))) {
      const [target, role, duplicateRole, department] = params;
      const employer = sql.includes("a.visible_to_employers = 1");
      assert.equal(duplicateRole, role);
      assert.ok(sql.includes("authorDept.department_id = ?") || sql.includes("a.visible_to_employers = 1"));
      const row = fixtures.find((item) => String(sql.includes("WHERE a.id = ?") ? item.id : item.public_id) === String(target));
      return [row && (!sql.includes("ac.name = 'General'") || row.category === "General") &&
        (employer ? row.visible_to_employers === 1 : (row.category !== "Department" || (role !== "employer" && (role === "admin" || row.department === department))))
        ? [{ ...row, id: row.public_id }] : []];
    }
    assert.ok(sql.includes("authorDept.department_id = ?") || sql.includes("a.visible_to_employers = 1"));
    const regular = sql.includes("LIMIT ? OFFSET ?");
    const filters = regular ? params.slice((params.length - 2) / 2, -2) : params;
    const [role, duplicateRole, department] = filters.slice(-3);
    assert.equal(duplicateRole, role);
    let rows = mode === "empty" ? [] : fixtures.filter(row => sql.includes("a.visible_to_employers = 1") ? row.visible_to_employers === 1 : row.category !== "Department" || (role !== "employer" && (role === "admin" || row.department === department)));
    if (sql.includes("ac.name = 'General'")) rows = rows.filter(row => row.category === "General");
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
      if (sql.includes("INSERT INTO announcements") || sql.includes("UPDATE announcements")) {
        announcementWrite = { sql, params };
      }
      if (sql.includes("FROM user_profiles")) return [[{ first_name: "Author", last_name: "Name" }]];
      if (sql.includes("SELECT name FROM announcement_categories")) return [mode === "invalid-category" ? [] : [{ name: categoryName }]];
      if (sql.includes("FROM announcements a") && sql.includes("FOR UPDATE")) return [mode === "forbidden" ? [] : [{ category_id: 1, category_name: "General", title: "Old", ...existingEventDates }]];
      if (sql.includes("SELECT id, title FROM announcements")) return [[{ id: 1, title: "Old" }]];
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
  const app = express(); app.use("/api/v1", routes);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return (path = "history", role = "student", department_id = 1, id = "viewer", department_code = null) => fetch(`http://127.0.0.1:${server.address().port}${base}${path}`, {
    headers: id ? { Authorization: `Bearer ${signAccessToken({ id, role, department_id, department_code })}` } : {},
  });
}
function seed() {
  for (const [key, path] of [["feed-a", "history"], ["feed-b", "history"], ["categories", "categories"]]) cache.set(key, { userId: key, path: base + path, body: {} });
  cache.set("profile", { userId: "other", path: "/api/v1/account/user", body: {} });
}
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function request(data = {}) {
  return { verifiedUser: { id: "author", role: "department_head", department_code: "REG" }, params: { announcementId },
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

test("employers have separate read caches and cannot resolve unshared announcement links", async t => {
  const get = await client(t);
  for (const path of ["history", "categories", fixtures[0].public_id, "1"]) {
    assert.equal((await get(path)).status, 200);
    const employer = await get(path, "employer");
    assert.equal(employer.status, ["history", "categories"].includes(path) ? 200 : 404);
    if (path === "history") { const body = await employer.json(); assert.deepEqual(body.pinned, []); assert.deepEqual(body.regular, []); }
  }
});

test("ordinary department heads keep viewing General posts but cannot create or keep General on an edit", async t => {
  const get = await client(t);
  const feed = await (await get("history", "department_head", 1, "head", "CCS")).json();
  assert(feed.pinned.some(item => item.category === "General"));
  assert.equal((await get(fixtures[0].public_id, "department_head", 1, "head", "CCS")).status, 200);
  for (const handler of [announcements.createAnnouncement, announcements.updateAnnouncement]) {
    for (const code of ["CCS", null, undefined]) {
      cache.flushAll(); seed(); announcementWrite = null; committed = false; emitted = 0;
      const req = request(); req.verifiedUser.department_code = code;
      const res = response(); await handler(req, res);
      assert.equal(res.statusCode, 403); assert.match(res.body.error, /registrar/);
      assert.equal(announcementWrite, null); assert.equal(committed, false); assert.equal(emitted, 0);
      assert.equal(cache.has("feed-a"), true);
    }
  }
  const req = request(); req.verifiedUser.department_code = "CCS"; delete req.body.category_id;
  const res = response(); await announcements.updateAnnouncement(req, res);
  assert.equal(res.statusCode, 403); // Omitting the category cannot retain a legacy General post.
});

test("employer feeds and direct links expose only explicitly shared General/Department posts", async t => {
  fixtures[1].visible_to_employers = 1;
  const get = await client(t);
  const body = await (await get("history", "employer")).json();
  assert.deepEqual(body.pinned, []); assert.equal(body.totalRecords, 1);
  assert.deepEqual(body.regular.map(row => row.public_id), [fixtures[1].public_id]);
  assert.equal((await get(fixtures[1].public_id, "employer")).status, 200);
  assert.equal((await get(fixtures[2].public_id, "employer")).status, 404);
});

test("employers still cannot create, edit, pin or delete announcements", async t => {
  const get = await client(t);
  const history = await get("history", "employer");
  const before = calls;
  for (const [method, path] of [["POST", "/announcement/new"], ["PATCH", `/announcements/${announcementId}`], ["PATCH", `/announcements/pin/${announcementId}`], ["DELETE", `/announcement/${announcementId}`]]) {
    const url = new URL(history.url); url.pathname = `/api/v1${path}`;
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${signAccessToken({ id: "employer", role: "employer" })}` } });
    assert.equal(res.status, 403);
  }
  assert.equal(calls, before);
});

test("employer visibility defaults off, persists explicit create/edit values and rejects malformed flags", async () => {
  for (const [handler, slot] of [[announcements.createAnnouncement, 7], [announcements.updateAnnouncement, 7]]) {
    for (const [value, expected] of [[undefined, 0], ["0", 0], ["1", 1], [true, 1]]) {
      seed();
      const res = response(); await handler(request(value === undefined ? {} : { visible_to_employers: value }), res);
      assert(res.statusCode < 300); assert.equal(announcementWrite.params[slot], expected);
    }
    const res = response(); await handler(request({ visible_to_employers: "everyone" }), res);
    assert.equal(res.statusCode, 400);
  }
  existingEventDates.visible_to_employers = 1;
  seed();
  const res = response(); await announcements.updateAnnouncement(request({ title: "Only title" }), res);
  assert.equal(res.statusCode, 200); assert.equal(announcementWrite.params[7], 1);
});

test("General and department announcement recipient queries exclude employers before notification and socket delivery", async () => {
  for (const [role, code, category] of [["admin", null, "General"], ["department_head", "REG", "General"], ["department_head", "CCS", "Department"]]) {
    cache.flushAll(); seed(); committed = false; categoryName = category;
    const execute = connection.execute, query = connection.query;
    let recipientSql, notificationRows; const rooms = [];
    connection.execute = async (sql, params) => {
      if (sql.includes("FROM users u") && sql.includes("JOIN roles r")) {
        recipientSql = sql;
        return [[{ id: "student" }, ...(!sql.includes("r.role != 'employer'") ? [{ id: "employer" }] : [])]];
      }
      return execute(sql, params);
    };
    connection.query = async (sql, params) => { notificationRows = params[0]; return query(sql, params); };
    const req = request(); req.verifiedUser = { id: "author", role, department_code: code };
    req.app.get = () => ({ to: room => ({ emit() { assert(committed); rooms.push(room); } }) });
    const res = response(); await announcements.createAnnouncement(req, res);
    connection.execute = execute; connection.query = query;
    assert.equal(res.statusCode, 201); assert.match(recipientSql, /r.role != 'employer'/);
    assert.deepEqual(notificationRows.map(row => row[0]), ["student"]);
    assert.deepEqual(rooms, ["user-student"]);
  }
});

test("ordinary department heads can create department posts and convert a legacy General post to Department", async () => {
  categoryName = "Department";
  for (const handler of [announcements.createAnnouncement, announcements.updateAnnouncement]) {
    cache.flushAll(); seed(); committed = false;
    const req = request({ category_id: 2 }); req.verifiedUser.department_code = "CCS";
    const res = response(); await handler(req, res);
    assert(res.statusCode < 300); assert.equal(committed, true);
  }
});

test("role, user and department keys preserve announcement visibility on hits", async (t) => {
  const get = await client(t);
  for (const [role, department, ids] of [["student", 1, [2]], ["student", 2, [3]], ["department_head", 1, [2]], ["admin", 1, [2, 3]]]) {
    const path = "history?category=Department";
    const first = await (await get(path, role, department)).json(); assert.deepEqual(first.regular.map(row => row.id), ids);
    const before = calls; assert.deepEqual(await (await get(path, role, department)).json(), first); assert.equal(calls, before);
  }
  const before = calls; await get("history?category=Department", "student", 1, "other"); assert.equal(calls, before + 2);
  assert.equal((await get("history", "unknown")).status, 403); assert.equal((await get("categories", "student", 1, null)).status, 401);
});

test("UUID and legacy announcement links load only posts visible to the viewer", async (t) => {
  const get = await client(t);
  const uuid = fixtures[1].public_id;
  assert.equal((await get(uuid, "student", 1)).status, 200);
  assert.equal((await (await get(uuid, "student", 1)).json()).id, uuid);
  assert.equal((await get("2", "student", 1)).status, 200);
  assert.equal((await get(uuid, "student", 2)).status, 404);
  assert.equal((await get(uuid, "employer", 1)).status, 404);
  assert.equal((await get(uuid, "admin", null)).status, 200);
  assert.equal((await get("not-an-id", "student", 1)).status, 400);
});

test("REG department heads only receive General announcements on feeds, cached reads and direct links", async (t) => {
  fixtures.push({ id: 4, public_id: "42038a27-bc63-4506-9c4f-20ffbe88396c", category: "General", department: null, is_pinned: false, title: "General regular" });
  const get = await client(t);
  const ordinary = await (await get("history", "department_head", 1, "head", "CCS")).json();
  assert.ok(ordinary.regular.some(row => row.category === "Department"));

  const first = await (await get("history", "department_head", 1, "head", "REG")).json();
  assert.deepEqual(first.pinned.map(row => row.category), ["General"]);
  assert.deepEqual(first.regular.map(row => row.category), ["General"]);
  assert.equal(first.totalRecords, 1);
  const before = calls;
  assert.deepEqual(await (await get("history", "department_head", 1, "head", "REG")).json(), first);
  assert.equal(calls, before);

  const restricted = await (await get("history?category=Department", "department_head", 1, "head", "REG")).json();
  assert.deepEqual(restricted.pinned, []);
  assert.deepEqual(restricted.regular, []);
  assert.equal(restricted.totalRecords, 0);
  assert.equal((await get(fixtures[0].public_id, "department_head", 1, "head", "REG")).status, 200);
  assert.equal((await get(fixtures[1].public_id, "department_head", 1, "head", "REG")).status, 404);
  assert.equal((await get("2", "department_head", 1, "head", "REG")).status, 404);
});

test("admins can read all departments including direct announcement links", async (t) => {
  const get = await client(t);
  const feed = await (await get("history?category=Department", "admin", null, "administrator", "REG")).json();
  assert.deepEqual(feed.regular.map(row => row.department), [1, 2]);
  for (const item of fixtures) {
    assert.equal((await get(item.public_id, "admin", null, "administrator", "REG")).status, 200);
  }
});

test("admin announcement writes accept General and reject every non-General category", async () => {
  for (const handler of [announcements.createAnnouncement, announcements.updateAnnouncement]) {
    for (const name of ["General", "Department", "Other"]) {
      cache.flushAll(); seed(); categoryName = name; announcementWrite = null; committed = false;
      const req = request({ category_id: 2 });
      req.verifiedUser = { id: "administrator", role: "admin", department_id: null };
      const res = response();
      await handler(req, res);
      if (name === "General") {
        assert.ok(res.statusCode < 300);
        assert.ok(announcementWrite);
        assert.equal(committed, true);
      } else {
        assert.equal(res.statusCode, 400);
        assert.equal(announcementWrite, null);
        assert.equal(committed, false);
        assert.equal(cache.has("feed-a"), true);
      }
    }
  }
});

test("admins can delete another department's announcement without owning it", async () => {
  for (const item of fixtures.filter(row => row.category === "Department")) {
    cache.flushAll(); seed();
    const req = request();
    req.verifiedUser = { id: "administrator", role: "admin", department_id: null };
    req.params.announcementId = item.public_id;
    let deletion;
    const execute = connection.execute;
    connection.execute = async (sql, params) => {
      if (sql.startsWith("DELETE FROM announcements")) deletion = { sql, params };
      return execute(sql, params);
    };
    const res = response();
    await announcements.deleteAnnouncement(req, res);
    connection.execute = execute;
    assert.equal(res.statusCode, 200);
    assert.match(deletion.sql, /author_id = \? OR \? = 'admin'/);
    assert.deepEqual(deletion.params, [item.public_id, "administrator", "admin"]);
    assert.equal(committed, true);
    assert.equal(cache.has("feed-a"), false);
  }
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

test("new announcements expose a UUID and store it in recipient notifications", async () => {
  seed();
  let notificationRows;
  const originalQuery = connection.query;
  connection.query = async (sql, params) => {
    if (sql.includes("INSERT INTO notifications")) notificationRows = params[0];
    return originalQuery(sql, params);
  };
  const res = response();
  await announcements.createAnnouncement(request(), res);
  assert.match(res.body.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  assert.equal(announcementWrite.params[0], res.body.id);
  assert.equal(notificationRows[0].at(-1), res.body.id);
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
    assert.equal(activityLog[4], announcementId);
    assert.ok(activityLog[5].includes(expected));
    assert.ok(!activityLog[5].includes(`announcement ${announcementId}`));
    cache.flushAll();
  }
});

test("general-to-department edit evicts previously visible content before socket refresh", async () => {
  seed(); categoryName = "Department"; const res = response();
  const req = request({ category_id: 2 }); req.verifiedUser.department_code = "CCS";
  await announcements.updateAnnouncement(req, res);
  assert.equal(res.statusCode, 200); assert.equal(cache.has("feed-a"), false); assert.equal(emitted, 1);
});

test("event date is saved, can be cleared, and invalid calendar dates are rejected", async () => {
  for (const [handler, value, expected] of [
    [announcements.createAnnouncement, "2026-11-12", "2026-11-12"],
    [announcements.updateAnnouncement, "2026-11-12", "2026-11-12"],
    [announcements.updateAnnouncement, "", null],
  ]) {
    seed(); announcementWrite = null; const res = response();
    await handler(request({ event_date: value }), res);
    assert.ok(res.statusCode < 300);
    assert.ok(announcementWrite.sql.includes("event_date"));
    assert.equal(handler === announcements.createAnnouncement
      ? announcementWrite.params[5]
      : announcementWrite.params[4], expected);
  }

  seed(); announcementWrite = null; const unchanged = response();
  await announcements.updateAnnouncement(request(), unchanged);
  assert.equal(unchanged.statusCode, 200);
  assert.equal(announcementWrite.params[3], 0);

  for (const handler of [announcements.createAnnouncement, announcements.updateAnnouncement]) {
    announcementWrite = null; const invalid = response();
    await handler(request({ event_date: "2026-02-30" }), invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(announcementWrite, null);
  }
});

test("announcement ranges are saved inclusively and invalid ranges never write or invalidate cache", async () => {
  for (const handler of [announcements.createAnnouncement, announcements.updateAnnouncement]) {
    for (const end of ["2026-10-30", "2026-11-02"]) {
      seed(); announcementWrite = null;
      const res = response();
      await handler(request({ event_date: "2026-10-30", event_end_date: end }), res);
      assert.ok(res.statusCode < 300);
      assert.match(announcementWrite.sql, /event_end_date/);
      assert.equal(announcementWrite.params[6], end);
      assert.equal(cache.has("feed-a"), false);
    }
    for (const input of [
      { event_date: "2026-10-30", event_end_date: "2026-10-29" },
      { event_date: "", event_end_date: "2026-10-30" },
      { event_date: "2026-10-30", event_end_date: "2026-02-30" },
      { event_date: "2026-10-30", event_end_date: 123 },
    ]) {
      seed(); announcementWrite = null;
      const res = response();
      await handler(request(input), res);
      assert.equal(res.statusCode, 400);
      assert.equal(announcementWrite, null);
      assert.equal(cache.has("feed-a"), true);
    }
  }
});

test("partial announcement edits validate against saved dates and clearing the start also clears its end", async () => {
  existingEventDates = { event_date: "2026-10-30", event_end_date: "2026-11-02" };
  for (const input of [{ title: "Only title" }, { event_end_date: "2026-11-03" }, { event_end_date: "" }, { event_date: "" }]) {
    seed(); announcementWrite = null;
    const res = response();
    await announcements.updateAnnouncement(request(input), res);
    assert.equal(res.statusCode, 200);
    if (!Object.hasOwn(input, "event_date")) assert.equal(announcementWrite.params[3], 0);
    if (input.event_end_date === "") {
      assert.equal(announcementWrite.params[5], 1);
      assert.equal(announcementWrite.params[6], null);
    } else if (input.event_date === "") {
      assert.deepEqual(announcementWrite.params.slice(3, 7), [1, null, 1, null]);
    } else if (input.event_end_date) {
      assert.equal(announcementWrite.params[6], input.event_end_date);
    } else {
      assert.equal(announcementWrite.params[5], 0);
    }
  }
  for (const input of [{ event_date: "2026-11-03" }, { event_end_date: "2026-10-29" }]) {
    seed(); announcementWrite = null;
    const res = response();
    await announcements.updateAnnouncement(request(input), res);
    assert.equal(res.statusCode, 400);
    assert.equal(announcementWrite, null);
    assert.equal(cache.has("feed-a"), true);
  }
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
      cache.set("hte-profile", {path:"/api/v1/reports/hte-annual/companies",userId:"admin",body:{}});
      cache.set("staff-profile",{path:"/api/v1/internship-records/department",userId:"head",body:{}});
      cache.set("evaluation-profile",{path:"/api/v1/evaluations/all",userId:"student",body:[]});
      cache.set("searched-profile",{path:"/api/v1/searched-user/student",userId:"staff",body:{}});
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

test("registrar heads can only create or edit General; regular heads can only use Department", async () => {
  for (const handler of [announcements.createAnnouncement, announcements.updateAnnouncement]) {
    for (const departmentCode of ["REG", "CCS"]) {
      for (const name of ["General", "Department", "Other"]) {
        cache.flushAll(); seed(); categoryName = name; announcementWrite = null; committed = false; emitted = 0;
        const req = request({ category_id: 2 }); req.verifiedUser.department_code = departmentCode;
        const res = response(); await handler(req, res);
        const allowed = name === (departmentCode === "REG" ? "General" : "Department");
        if (allowed) { assert.ok(res.statusCode < 300); assert.ok(announcementWrite); assert.equal(committed, true); }
        else { assert.equal(res.statusCode, 403); assert.equal(announcementWrite, null); assert.equal(committed, false); assert.equal(emitted, 0); assert.equal(cache.has("feed-a"), true); }
      }
    }
  }
});

test("a registrar cannot retain a legacy Department announcement by omitting category_id", async () => {
  cache.flushAll(); seed(); announcementWrite = null;
  const original = connection.execute;
  connection.execute = async (sql, params) => {
    if (sql.includes("FROM announcements a") && sql.includes("FOR UPDATE")) return [[{ category_id: 2, category_name: "Department", title: "Old", ...existingEventDates }]];
    return original(sql, params);
  };
  const req = request(); delete req.body.category_id;
  const res = response(); await announcements.updateAnnouncement(req, res);
  assert.equal(res.statusCode, 403); assert.equal(announcementWrite, null); assert.equal(committed, false);
});
