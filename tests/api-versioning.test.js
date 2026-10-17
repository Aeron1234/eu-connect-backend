import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { once } from "node:events";
import express from "express";
import cookieParser from "cookie-parser";
import { API_PREFIX, LEGACY_API_PREFIX, API_PREFIXES, canonicalApiPath, mountApiRoutes } from "../config/api.js";
import cache, { invalidateRouteCache } from "../config/cache/cache.js";
import { cacheRoute } from "../middleware/cache-middleware.js";
import { invalidateAttendanceHistoryCache } from "../config/cache/attendanceHistoryCache.js";
import { invalidateDocumentMetadataCache } from "../config/cache/documentMetadataCache.js";
import { invalidateEvaluationHistoryCache } from "../config/cache/evaluationHistoryCache.js";
import { invalidateProfileOverviewCache } from "../config/cache/profileOverviewCache.js";
import { invalidateAnnualReportsCache } from "../config/cache/reportsCache.js";
import { invalidateWeeklyNarrativesCache } from "../config/cache/weeklyNarrativesCache.js";
import { invalidateNotificationsCache } from "../config/cache/notificationsCache.js";

process.env.ACCESS_TOKEN_SECRET = "api-version-test-access";
process.env.REFRESH_TOKEN_SECRET = "api-version-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "api-version-test-temp";
const { signAccessToken, REFRESH_TOKEN_TTL_MS } = await import("../config/jwt.js");
const { verifyUser } = await import("../middleware/verifyUser.js");
const { verifyRole } = await import("../middleware/verifyRole.js");
const { generalLimiter, authLimiter, mediumLimiter } = await import("../middleware/rateLimiter.js");
const { setAuthCookies, clearAuthCookies } = await import("../config/authCookies.js");

beforeEach(() => { cache.flushAll(); delete process.env.CACHE_ENABLED; });
after(() => cache.close());

async function client(t, routes) {
  const app = express();
  app.use(express.json(), cookieParser());
  mountApiRoutes(app, routes);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return (path, { id = "api-version-viewer", role = "admin", method = "GET", body, authenticated = true } = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: {
        ...(authenticated ? { Authorization: `Bearer ${signAccessToken({ id, role })}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
}

test("canonical paths match only the API prefix and preserve query values", () => {
  for (const prefix of API_PREFIXES) {
    assert.equal(canonicalApiPath(prefix), API_PREFIX);
    assert.equal(canonicalApiPath(`${prefix}/accounts?q=/eu-connect/api&page=2`), `${API_PREFIX}/accounts?q=/eu-connect/api&page=2`);
    assert.equal(canonicalApiPath(`${prefix}?page=2`), `${API_PREFIX}?page=2`);
    assert.equal(canonicalApiPath(`${prefix.toUpperCase()}/accounts`), `${API_PREFIX}/accounts`);
  }
  for (const path of ["/eu-connect/api-other/accounts", "/api/v10/accounts", "/api/v2/accounts", "/api/reports/annex-c", "/socket.io", undefined]) {
    assert.equal(canonicalApiPath(path), path);
  }
});

test("both mounts preserve request bodies and authorization across multiple routers", async t => {
  const first = express.Router();
  const second = express.Router();
  first.use("/records", verifyUser, verifyRole(["admin"]));
  first.post("/records/:id", (req, res) => res.status(201).json({ id: req.params.id, body: req.body, query: req.query }));
  second.get("/other", (_req, res) => res.json({ secondRouter: true }));
  const request = await client(t, [first, second]);
  for (const prefix of API_PREFIXES) {
    const path = `${prefix}/records/record-123?label=hello%20world`;
    assert.equal((await request(path, { method: "POST", authenticated: false })).status, 401);
    assert.equal((await request(path, { method: "POST", role: "student" })).status, 403);
    const response = await request(path, { method: "POST", body: { name: "Record", active: false } });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: "record-123", body: { name: "Record", active: false }, query: { label: "hello world" } });
    assert.deepEqual(await (await request(`${prefix}/other`)).json(), { secondRouter: true });
  }
  assert.equal((await request("/api/v2/other")).status, 404);
  assert.equal((await request("/eu-connect/api-other/other")).status, 404);
});

test("aliases share cached reads and writes invalidate both directions", async t => {
  let version = 1;
  let reads = 0;
  const routes = express.Router();
  routes.get("/records", verifyUser, cacheRoute(), (req, res) => {
    reads++;
    res.json({ version, viewer: req.verifiedUser.id, page: req.query.page });
  });
  routes.patch("/records", verifyUser, (_req, res) => {
    version++;
    invalidateRouteCache(API_PREFIX + "/records");
    res.json({ version });
  });
  const request = await client(t, [routes]);
  assert.equal((await (await request(`${LEGACY_API_PREFIX}/records?page=1`)).json()).version, 1);
  const hit = await request(`${API_PREFIX}/records?page=1`);
  assert.equal(hit.headers.get("cache-control"), "private, no-store");
  assert.equal((await hit.json()).version, 1);
  assert.equal(reads, 1);
  assert.equal(cache.keys().length, 1);
  assert.equal(cache.get(cache.keys()[0]).path, API_PREFIX + "/records");
  await request(`${API_PREFIX}/records?page=2`);
  await request(`${API_PREFIX}/records?page=1`, { id: "another-viewer" });
  assert.equal(reads, 3);
  for (const prefix of API_PREFIXES) {
    assert.equal((await request(`${prefix}/records`, { method: "PATCH" })).status, 200);
    const otherPrefix = prefix === API_PREFIX ? LEGACY_API_PREFIX : API_PREFIX;
    assert.equal((await (await request(`${otherPrefix}/records?page=1`)).json()).version, version);
  }
  assert.equal(reads, 5);
});

test("invalidation recognizes legacy entries without matching query text or other API versions", () => {
  for (const [key, path] of Object.entries({ legacy: LEGACY_API_PREFIX + "/accounts", canonical: API_PREFIX + "/accounts", other: "/api/v2/accounts", query: API_PREFIX + "/profiles" })) {
    cache.set(key, { path, userId: "alice", body: {} });
  }
  cache.set("bob", { path: LEGACY_API_PREFIX + "/accounts", userId: "bob", body: {} });
  invalidateRouteCache(LEGACY_API_PREFIX + "/accounts", "alice");
  assert.deepEqual(cache.keys().sort(), ["bob", "other", "query"]);
});

test("dynamic cache families invalidate old and new paths while retaining unrelated data", () => {
  const families = [
    [invalidateAttendanceHistoryCache, "/internship-records/dtr/record-1"],
    [invalidateDocumentMetadataCache, "/internship-records/documents/record-1"],
    [invalidateEvaluationHistoryCache, "/internship-records/evaluations/record-1"],
    [invalidateProfileOverviewCache, "/internship-records/overview/record-1"],
    [invalidateAnnualReportsCache, "/reports/annex-c/report-1"],
    [invalidateWeeklyNarrativesCache, "/internship-records/weekly-narratives/record-1"],
  ];
  for (const [invalidate, resource] of families) {
    cache.flushAll();
    for (const prefix of API_PREFIXES) cache.set(prefix, { path: prefix + resource, userId: "viewer", body: {} });
    cache.set("unrelated", { path: API_PREFIX + "/accounts", userId: "viewer", body: {} });
    invalidate();
    assert.deepEqual(cache.keys(), ["unrelated"], resource);
  }
});

test("notification invalidation still affects only the recipient across both prefixes", () => {
  for (const prefix of API_PREFIXES) {
    for (const userId of ["alice", "bob"]) {
      cache.set(prefix + userId, { path: prefix + "/notifications/unread-count", userId, body: {} });
    }
  }
  invalidateNotificationsCache("alice");
  assert.equal(cache.keys().length, 2);
  assert.ok(cache.keys().every(key => cache.get(key).userId === "bob"));
});

test("switching API aliases cannot bypass read, mutation or login rate limits", async t => {
  const routes = express.Router();
  routes.get("/limited/:id", verifyUser, generalLimiter, (_req, res) => res.sendStatus(200));
  routes.patch("/limited", verifyUser, mediumLimiter, (_req, res) => res.sendStatus(200));
  routes.post("/auth/login", authLimiter, (_req, res) => res.sendStatus(401));
  const request = await client(t, [routes]);
  for (const [resource, method, budget, body, authenticated] of [
    ["/limited/record-1", "GET", 100, undefined, true],
    ["/limited", "PATCH", 40, undefined, true],
    ["/auth/login", "POST", 10, { username: "api-version-login" }, false],
  ]) {
    for (let i = 0; i < budget; i++) {
      const response = await request(API_PREFIXES[i % 2] + resource, { method, body, authenticated, id: "api-version-limit" });
      assert.equal(response.status, authenticated ? 200 : 401);
      await response.arrayBuffer();
    }
    for (const prefix of API_PREFIXES) {
      assert.equal((await request(prefix + resource, { method, body, authenticated, id: "api-version-limit" })).status, 429);
    }
  }
});

test("auth cookies cover both refresh paths and are cleared with the same security attributes", () => {
  const originalEnv = process.env.NODE_ENV;
  try {
    for (const production of [false, true]) {
      process.env.NODE_ENV = production ? "production" : "test";
      const set = [];
      const cleared = [];
      const response = { cookie: (...args) => set.push(args), clearCookie: (...args) => cleared.push(args) };
      setAuthCookies(response, { accessToken: "access-test", refreshToken: "refresh-test" });
      clearAuthCookies(response);
      assert.equal(set.length, 3);
      assert.deepEqual(set.map(([name, , options]) => [name, options.path]), [
        ["access_token", "/"], ["refresh_token", "/api/v1/auth"], ["refresh_token", "/eu-connect/api/auth"],
      ]);
      for (const [name, value, options] of set) {
        assert.equal(options.secure, production);
        assert.equal(options.httpOnly, true);
        assert.equal(options.sameSite, "lax");
        assert.equal(options.maxAge, name === "access_token" ? 15 * 60 * 1000 : REFRESH_TOKEN_TTL_MS);
        assert.equal(value, name === "access_token" ? "access-test" : "refresh-test");
        const clearedCookie = cleared.find(([cookieName, cookieOptions]) => cookieName === name && cookieOptions.path === options.path);
        assert.ok(clearedCookie);
        const { maxAge: _maxAge, ...expectedOptions } = options;
        assert.deepEqual(clearedCookie[1], expectedOptions);
      }
    }
  } finally {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  }
});
