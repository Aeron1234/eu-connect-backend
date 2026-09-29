import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import cache from "../config/cache.js";
import { db } from "../config/db.js";
import * as posts from "../controllers/internshipPostsControllers.js";

process.env.ACCESS_TOKEN_SECRET = "postings-test-access";
process.env.REFRESH_TOKEN_SECRET = "postings-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "postings-test-temp";
process.env.CACHE_ENABLED = "true";
const { default: routes } = await import("../routes/internshipPostsRoutes.js");
const { default: dashboardRoutes } = await import("../routes/dashboardRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const originalGetConnection = db.getConnection;
const base = "/eu-connect/api/";
let calls, connection, mode, existingFavorite;
beforeEach(() => {
  cache.flushAll(); calls = 0; mode = "success"; existingFavorite = false;
  connection = {
    async beginTransaction() {}, async rollback() {}, release() {},
    async commit() {
      assert.ok(cache.has("alice"), "invalidate only after commit");
      if (mode === "commit-failure") throw new Error("failed commit");
    },
    async query() { return [{ affectedRows: 1 }]; },
    async execute(sql, params = []) {
      calls++;
      if (mode === "db-error") throw new Error("offline");
      if (sql.includes("COUNT(*)")) return [[{ total: mode === "empty" ? 0 : 1 }]];
      if (sql.includes("SELECT id FROM courses")) return [[{ id: 1 }]];
      if (sql.includes("SELECT id FROM internship_favorites")) return [existingFavorite ? [{ id: "favorite" }] : []];
      if (sql.includes("SELECT posting_id FROM internship_favorites")) return [params[0] === "alice" ? [{ posting_id: "p" }] : []];
      if (sql.includes("JOIN courses")) return [[{ posting_id: "p", course_id: 1, course_name: "Computing", short_name: "CS" }]];
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
    const before = calls; await get("internship-postings" + query); assert.equal(calls, before + 4);
    await get("internship-postings" + query); assert.equal(calls, before + 4);
  }
});

test("posted-jobs caches per employer/page and keeps authorization checks", async (t) => {
  const get = await client(t);
  await get("posted-jobs", "owner", "employer"); assert.equal(calls, 2);
  await get("posted-jobs", "owner", "employer"); assert.equal(calls, 2);
  await get("posted-jobs?page=2", "owner", "employer");
  await get("posted-jobs", "other", "employer"); assert.equal(calls, 6);
  assert.equal((await get("posted-jobs", "owner", "student")).status, 403);
  assert.equal((await get("internship-postings", null)).status, 401);
  assert.equal((await get("internship-postings", "alice", "unknown")).status, 403);
  assert.equal(calls, 6);
});

test("creation, edits, course-only edits and deletion clear both lists for everyone", async () => {
  for (const [handler, data] of [[posts.createInternshipPosting, body], [posts.updateInternshipPosting, { status: "filled" }], [posts.updateInternshipPosting, { course_ids: [1] }], [posts.deleteInternshipPosting, {}]]) {
    cache.flushAll(); seed(); const res = response(); await handler(request("owner", "employer", data), res);
    assert.ok(res.statusCode < 300); assert.deepEqual(cache.keys(), ["profile"]);
  }
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
