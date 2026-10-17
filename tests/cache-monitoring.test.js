import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import cache, { invalidateRouteCache } from "../config/cache/cache.js";
import { getCacheMetrics, recordCacheMetric } from "../config/cache/cacheMetrics.js";
import { cacheRoute } from "../middleware/cache-middleware.js";

process.env.ACCESS_TOKEN_SECRET = "metrics-test-access";
process.env.REFRESH_TOKEN_SECRET = "metrics-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "metrics-test-temp";
const { default: routes } = await import("../features/cache-monitoring/routes/cacheMonitoringRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");

beforeEach(() => {
  cache.flushAll();
  delete process.env.CACHE_ENABLED;
});
after(() => cache.close());

function request(extra = {}) {
  return {
    method: "GET",
    originalUrl: "/private/secret-user?token=secret-query",
    route: { path: "/private/:userId" },
    verifiedUser: { id: "secret-user", role: "student" },
    ...extra,
  };
}

function response() {
  return {
    statusCode: 200, locals: {}, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    getHeader(name) { return this.headers[name]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function run(req = request(), handler = (res) => res.json({ private: "secret-body" })) {
  const res = response();
  cacheRoute(60)(req, res, () => handler(res));
  return res;
}

const totals = () => getCacheMetrics().totals;

test("metrics count response hits and misses, excluding invalidation scans", () => {
  const before = totals();
  run();
  run();
  invalidateRouteCache("/not-matching");
  const afterScan = totals();
  assert.equal(afterScan.hit - before.hit, 1);
  assert.equal(afterScan.miss - before.miss, 1);
  assert.equal(afterScan.store - before.store, 1);
  assert.equal(afterScan.invalidation_calls - before.invalidation_calls, 1);
  assert.equal(afterScan.invalidated_entries - before.invalidated_entries, 0);

  invalidateRouteCache("/private/secret-user");
  assert.equal(totals().invalidated_entries - before.invalidated_entries, 1);
  assert.equal(totals().hitRate, totals().hit / totals().lookups);
});

test("bypass and skipped-store reasons are counted without caching the response", () => {
  const before = totals();
  run(request({ method: "POST" }));
  run(request({ verifiedUser: null }));
  process.env.CACHE_ENABLED = "false";
  run();
  delete process.env.CACHE_ENABLED;

  const skips = [
    ["skip_status", (res) => res.status(500).json({})],
    ["skip_opt_out", (res) => { res.locals.skipCache = true; res.json({}); }],
    ["skip_cookie", (res) => { res.set("Set-Cookie", "private"); res.json({}); }],
    ["skip_generation", (res) => { invalidateRouteCache("/none"); res.json({}); }],
    ["skip_oversized", (res) => res.json("a".repeat(256 * 1024 + 1))],
    ["skip_serialization", (res) => res.json(undefined)],
  ];
  for (const [event, handler] of skips) {
    cache.flushAll();
    run(request(), handler);
    assert.equal(totals()[event] - before[event], 1, event);
  }
  for (const event of ["bypass_method", "bypass_identity", "bypass_disabled"]) {
    assert.equal(totals()[event] - before[event], 1, event);
  }
});

test("cache failures remain fail-open and metrics expose only bounded route templates", () => {
  const before = totals();
  const get = cache.get;
  const set = cache.set;
  try {
    cache.get = () => { throw Error("read failed"); };
    assert.deepEqual(run().body, { private: "secret-body" });
    cache.get = get;
    cache.set = () => { throw Error("store failed"); };
    assert.deepEqual(run().body, { private: "secret-body" });
  } finally {
    cache.get = get;
    cache.set = set;
  }
  assert.equal(totals().read_error - before.read_error, 1);
  assert.equal(totals().write_error - before.write_error, 1);

  for (let i = 0; i < 300; i++) recordCacheMetric("miss", `/route-${i}`);
  const snapshot = getCacheMetrics();
  assert.ok(snapshot.routes.length <= 129);
  assert.ok(snapshot.routes.some((row) => row.route === "(other)"));
  const body = JSON.stringify(snapshot);
  assert.ok(body.includes("/private/:userId"));
  for (const secret of ["secret-user", "secret-query", "secret-body"]) {
    assert.ok(!body.includes(secret));
  }
});

test("metrics endpoint is admin-only, uncached, and read-only", async (t) => {
  const app = express();
  app.use("/api/v1", routes);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  const get = (role) => fetch(
    `http://127.0.0.1:${server.address().port}/api/v1/cache/metrics`,
    { headers: role ? { Authorization: `Bearer ${signAccessToken({ id: "viewer", role })}` } : {} },
  );

  assert.equal((await get()).status, 401);
  for (const role of ["student", "employer", "department_head"]) {
    assert.equal((await get(role)).status, 403);
  }
  run();
  const before = totals();
  const res = await get("admin");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  const body = await res.json();
  assert.equal(body.scope, "single_process");
  assert.equal(body.storage.keys, 1);
  assert.equal(body.storage.maxKeys, 1000);
  assert.ok(body.processMemoryBytes.heapUsed > 0);
  assert.ok(!JSON.stringify(body).includes("secret-user"));
  assert.deepEqual(totals(), before);

  process.env.CACHE_ENABLED = "false";
  assert.equal((await (await get("admin")).json()).cacheEnabled, false);
});
