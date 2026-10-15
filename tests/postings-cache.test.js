import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import cache from "../config/cache/cache.js";
import { db } from "../config/db.js";
import * as posts from "../features/internship-posts/controllers/internshipPostsControllers.js";

process.env.ACCESS_TOKEN_SECRET = "postings-test-access";
process.env.REFRESH_TOKEN_SECRET = "postings-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "postings-test-temp";
process.env.CACHE_ENABLED = "true";
const { default: routes } = await import("../features/internship-posts/routes/internshipPostsRoutes.js");
const { default: dashboardRoutes } = await import("../features/dashboard/routes/dashboardRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const originalGetConnection = db.getConnection;
const base = "/eu-connect/api/";
let calls, connection, mode, existingFavorite, activityLog;
beforeEach(() => {
  cache.flushAll(); calls = 0; mode = "success"; existingFavorite = false; activityLog = null;
  connection = {
    async beginTransaction() {}, async rollback() {}, release() {},
    async commit() {
      assert.ok(cache.has("alice"), "invalidate only after commit");
      if (mode === "commit-failure") throw new Error("failed commit");
    },
    async query() { return [{ affectedRows: 1 }]; },
    async execute(sql, params = []) {
      calls++;
      if (sql.includes("INSERT INTO activity_logs")) activityLog = params;
      if (mode === "db-error") throw new Error("offline");
      if (sql.trim().startsWith("SELECT COUNT(*) AS total")) return [[{ total: mode === "empty" ? 0 : 1 }]];
      if (sql.includes("FROM courses WHERE id IN")) return [[{ id: 1, course_name: "Computing" }]];
      if (sql.includes("SELECT id FROM internship_favorites")) return [existingFavorite ? [{ id: "favorite" }] : []];
      if (sql.includes("JOIN courses")) return [[{ posting_id: "p", course_id: 1, course_name: "Computing", short_name: "CS" }]];
      if (sql.includes("AS favorite_for_requester")) return [mode === "empty" ? [] : [{ id: "p", employer_id: "owner", deleted_at: null, company_name: "Company", position: "Intern", favorite_for_requester: params[0] === "alice" ? 1 : 0, total_postings: 1 }]];
      if (sql.includes("AS total_records")) return [mode === "empty" ? [] : [{ id: "p", position: "Intern", total_records: 1 }]];
      if (sql.trim().startsWith("SELECT")) return [mode === "empty" ? [] : [{ id: "p", employer_id: "owner", deleted_at: null, company_name: "Company", position: "Intern" }]];
      return [{ affectedRows: 1 }];
    },
  };
  db.getConnection = async () => connection;
});
after(async () => { db.getConnection = originalGetConnection; cache.close(); await db.end(); });

async function client(t) {
  const app = express(); app.use(base.slice(0, -1), routes, dashboardRoutes);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return (path, id = "alice", role = "student") => fetch(`http://127.0.0.1:${server.address().port}${base}${path}`, {
    headers: id ? { Authorization: `Bearer ${signAccessToken({ id, role })}` } : {},
  });
}
function seed() {
  for (const [key, userId, route] of [["alice", "alice", "internship-postings"], ["alice-filter", "alice", "internship-postings"], ["bob", "bob", "internship-postings"], ["jobs", "owner", "posted-jobs"], ["profile", "alice", "account/user"]]) {
    cache.set(key, { userId, path: base + route, body: {} });
  }
}
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
const body = { company_name: "Company", position: "Intern", vacancies: 1, location: "City", work_type: "remote", description: "Internship", contact_email: "test@example.com", course_ids: [1] };
function request(id = "owner", role = "employer", data = body) { return { verifiedUser: { id, role }, params: { postingId: "p" }, body: data }; }

test("listing caches user-specific ownership/favorites without mixing users", async (t) => {
  const get = await client(t);
  const alice = await (await get("internship-postings")).json();
  assert.equal(alice.data[0].isFavorited, true); assert.equal(alice.data[0].isOwner, false);
  const before = calls; assert.deepEqual(await (await get("internship-postings")).json(), alice); assert.equal(calls, before);
  const bob = await (await get("internship-postings", "bob")).json(); assert.equal(bob.data[0].isFavorited, false);
  const owner = await (await get("internship-postings", "owner", "employer")).json(); assert.equal(owner.data[0].isOwner, true);
  for (const key of cache.keys()) { const ttl = cache.getTtl(key) - Date.now(); assert.ok(ttl > 25000 && ttl <= 30000); }
});

test("all posting filters and pagination get distinct cached results", async (t) => {
  const get = await client(t);
  for (const query of ["", "?page=2", "?limit=20", "?mine=true", "?favorite=favorited", "?favorite=not_favorited", "?courseId=1", "?search=Company", "?workType=remote"]) {
    const before = calls; await get("internship-postings" + query); assert.equal(calls, before + 2);
    await get("internship-postings" + query); assert.equal(calls, before + 2);
  }
});

test("posting page folds favorite lookup into its SELECT without changing JSON", async (t) => {
  const get = await client(t);
  const queries = [];
  const originalExecute = connection.execute;
  connection.execute = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes("JOIN courses")) {
      calls++;
      return [[
        { posting_id: "p", course_id: 2, course_name: "Engineering", short_name: "ENG" },
        { posting_id: "p", course_id: 1, course_name: "Computing", short_name: "CS" },
      ]];
    }
    return originalExecute(sql, params);
  };
  const result = await (await get("internship-postings?workType=remote&search=Company&mine=true&courseId=1&favorite=favorited&page=2&limit=5")).json();
  assert.equal(queries.length, 2);
  const filters = ["remote", "%Company%", "%Company%", "alice", "1", "alice"];
  assert.deepEqual(queries[0].params, ["alice", ...filters, ...filters, 5, 5]);
  assert.deepEqual(queries[1].params, ["p"]);
  assert.match(queries[0].sql, /EXISTS \([\s\S]*FROM internship_favorites fav[\s\S]*\) AS favorite_for_requester/);
  assert.match(queries[0].sql, /SELECT COUNT\(\*\) FROM internship_postings ip WHERE/);
  assert.equal(result.data[0].isFavorited, true);
  assert.equal(result.data[0].isOwner, false);
  assert.equal("favorite_for_requester" in result.data[0], false);
  assert.equal("total_postings" in result.data[0], false);
  assert.deepEqual(result.data[0].courses, [
    { id: 2, name: "Engineering", shortName: "ENG" },
    { id: 1, name: "Computing", shortName: "CS" },
  ]);
});

test("posted-jobs caches per employer/page and keeps authorization checks", async (t) => {
  const get = await client(t);
  await get("posted-jobs", "owner", "employer"); assert.equal(calls, 1);
  await get("posted-jobs", "owner", "employer"); assert.equal(calls, 1);
  await get("posted-jobs?page=2", "owner", "employer");
  await get("posted-jobs", "other", "employer"); assert.equal(calls, 3);
  assert.equal((await get("posted-jobs", "owner", "student")).status, 403);
  assert.equal((await get("internship-postings", null)).status, 401);
  assert.equal((await get("internship-postings", "alice", "unknown")).status, 403);
  assert.equal(calls, 3);
});

test("creation, edits, course-only edits and deletion clear both lists for everyone", async () => {
  for (const [handler, data] of [[posts.createInternshipPosting, body], [posts.updateInternshipPosting, { status: "filled" }], [posts.updateInternshipPosting, { course_ids: [1] }], [posts.deleteInternshipPosting, {}]]) {
    cache.flushAll(); seed(); const res = response(); await handler(request("owner", "employer", data), res);
    assert.ok(res.statusCode < 300); assert.deepEqual(cache.keys(), ["profile"]);
  }
});

test("posting edits and moderation deletes log the position, with IDs in structured fields", async () => {
  for (const [handler, role, data] of [
    [posts.updateInternshipPosting, "employer", { position: "Intern" }],
    [posts.deleteInternshipPosting, "admin", {}],
  ]) {
    seed();
    const res = response();
    await handler(request(role === "admin" ? "admin" : "owner", role, data), res);
    assert.equal(res.statusCode, 200);
    assert.equal(activityLog[4], "p");
    assert.match(activityLog[5], /posting "Intern" at Company/);
    assert.ok(!activityLog[5].includes("posting p"));
    assert.ok(!activityLog[5].includes("employer owner"));
    if (role === "admin") assert.equal(JSON.parse(activityLog[6]).employer_id, "owner");
    cache.flushAll();
  }
});

test("creating a posting logs its title and submitted details", async () => {
  seed();
  const posting = {
    ...body,
    position: "Software Developer Intern",
    location: "Lucena City",
    duration_hours: 486,
    requirements: "Basic programming skills",
    contact_name: "HR Department",
    contact_phone: "09123456789",
    contact_website: "company.ph",
  };
  const res = response();
  await posts.createInternshipPosting(request("owner", "employer", posting), res);

  assert.equal(res.statusCode, 201);
  assert.equal(activityLog[2], "internship_posting_created");
  assert.equal(activityLog[4], res.body.id);
  assert.match(activityLog[5], /internship post "Software Developer Intern" at Company/);
  assert.deepEqual(JSON.parse(activityLog[6]), {
    company_name: "Company",
    position: "Software Developer Intern",
    vacancies: 1,
    location: "Lucena City",
    work_type: "remote",
    duration_hours: 486,
    description: "Internship",
    requirements: "Basic programming skills",
    contact_name: "HR Department",
    contact_email: "test@example.com",
    contact_phone: "09123456789",
    contact_website: "company.ph",
    course_ids: [1],
    eligible_courses: ["Computing"],
  });
});

test("adding/removing favorites clears only that student's posting variants", async () => {
  for (const exists of [false, true]) {
    cache.flushAll(); seed(); existingFavorite = exists; const res = response();
    await posts.toggleInternshipFavorite(request("alice", "student"), res);
    assert.equal(res.statusCode, exists ? 200 : 201); assert.equal(res.body.isFavorited, !exists);
    assert.deepEqual(cache.keys().sort(), ["bob", "jobs", "profile"]);
  }
});

test("all failed commits preserve caches, including both favorite branches", async () => {
  const log = console.error;
  try {
    console.error = () => {}; mode = "commit-failure";
    for (const [handler, exists] of [[posts.createInternshipPosting, false], [posts.updateInternshipPosting, false], [posts.deleteInternshipPosting, false], [posts.toggleInternshipFavorite, false], [posts.toggleInternshipFavorite, true]]) {
      cache.flushAll(); seed(); existingFavorite = exists; const res = response(); await handler(request(), res);
      assert.equal(res.statusCode, 500); assert.equal(cache.keys().length, 5);
    }
  } finally { console.error = log; }
});

test("invalid and unauthorized changes leave cached lists intact", async () => {
  seed();
  for (const handler of [posts.updateInternshipPosting, posts.deleteInternshipPosting]) {
    const res = response(); await handler(request("outsider"), res); assert.equal(res.statusCode, 403);
  }
  const res = response(); await posts.createInternshipPosting(request("owner", "employer", {}), res); assert.equal(res.statusCode, 400);
  assert.equal(cache.keys().length, 5);
});

test("read failures are not cached; empty listings are cached", async (t) => {
  const get = await client(t); const log = console.error;
  try {
    console.error = () => {}; mode = "db-error";
    assert.equal((await get("internship-postings")).status, 500); assert.equal(cache.keys().length, 0);
  } finally { console.error = log; }
  mode = "empty"; assert.deepEqual((await (await get("internship-postings")).json()).data, []);
  const before = calls; await get("internship-postings"); assert.equal(calls, before);
});
