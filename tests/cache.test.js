import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import cache, { invalidateUserCache, invalidateRouteCache } from "../config/cache.js";
import { cacheRoute } from "../middleware/cache-middleware.js";

const profile = "/eu-connect/api/account/user";
const accounts = "/eu-connect/api/accounts";
const middleware = cacheRoute(60);

function request(id = "alice", url = profile, extra = {}) {
  return { method: "GET", originalUrl: url, verifiedUser: { id, role: "student" }, ...extra };
}

function response() {
  return {
    statusCode: 200, locals: {}, headers: {},
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    getHeader(name) { return this.headers[name.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function run(req, body, handler = (res) => res.json(body)) {
  const res = response();
  let calls = 0;
  middleware(req, res, () => { calls++; handler(res); });
  return { res, calls };
}

beforeEach(() => { cache.flushAll(); delete process.env.CACHE_ENABLED; });
after(() => cache.close());

test("different users never share profile data; same user gets a cache hit", () => {
  run(request(), { name: "Alice" });
  assert.equal(run(request("bob"), { name: "Bob" }).res.body.name, "Bob");
  const hit = run(request(), { name: "Unexpected" });
  assert.equal(hit.calls, 0);
  assert.deepEqual(hit.res.body, { name: "Alice" });
  assert.equal(hit.res.getHeader("Cache-Control"), "private, no-store");
});

test("missing verified identity and non-GET requests bypass the cache", () => {
  for (const extra of [{ verifiedUser: undefined }, { verifiedUser: { id: "alice" } }, { method: "POST" }, { method: "HEAD" }]) {
    run(request("alice", profile, extra), { secret: true });
    assert.equal(run(request("alice", profile, extra), {}).calls, 1);
  }
  assert.equal(cache.keys().length, 0);
});

test("query strings and authorization context partition results", () => {
  run(request("alice", accounts + "?page=1"), [1]);
  assert.equal(run(request("alice", accounts + "?page=2"), [2]).calls, 1);
  run(request(), "student");
  assert.equal(run(request("alice", profile, { verifiedUser: { id: "alice", role: "admin" } }), "admin").calls, 1);
  assert.equal(run(request("alice", profile, { verifiedUser: { id: "alice", role: "student", department_id: 2 } }), "new department").calls, 1);
});

test("null and false are valid cached JSON; errors and opt-outs are not cached", () => {
  for (const value of [null, false, 0, ""]) {
    cache.flushAll(); run(request(), value);
    assert.equal(run(request(), "wrong").res.body, value);
  }
  for (const status of [201, 401, 403, 404, 500]) {
    cache.flushAll(); run(request(), null, (res) => res.status(status).json({ error: true }));
    assert.equal(run(request(), "fresh").calls, 1);
  }
  for (const optOut of [(res) => { res.locals.skipCache = true; }, (res) => res.set("Set-Cookie", "session=value")]) {
    cache.flushAll(); run(request(), null, (res) => { optOut(res); res.json({}); });
    assert.equal(run(request(), "fresh").calls, 1);
  }
});

test("user invalidation is exact and leaves other users cached", () => {
  run(request("a.*"), "first"); run(request("alice"), "other");
  invalidateUserCache("a.*");
  assert.equal(run(request("a.*"), "new").calls, 1);
  assert.equal(run(request("alice"), "wrong").calls, 0);
});

test("route invalidation clears all users and pages without matching query text", () => {
  run(request("admin1", accounts + "?page=1"), []);
  run(request("admin2", accounts + "?page=2"), []);
  run(request("alice", profile + "?search=" + accounts), {});
  invalidateRouteCache(accounts);
  assert.equal(run(request("admin1", accounts + "?page=1"), []).calls, 1);
  assert.equal(run(request("admin2", accounts + "?page=2"), []).calls, 1);
  assert.equal(run(request("alice", profile + "?search=" + accounts), {}).calls, 0);
});

test("a read started before invalidation cannot refill stale data", () => {
  const res = response();
  middleware(request(), res, () => {});
  invalidateUserCache("alice");
  res.json({ name: "Old" });
  assert.equal(run(request(), { name: "New" }).calls, 1);
});

test("TTL expiry forces a fresh read", () => {
  run(request(), "old");
  const key = cache.keys()[0];
  const now = Date.now;
  try {
    const expires = cache.getTtl(key);
    Date.now = () => expires + 1;
    assert.equal(run(request(), "new").calls, 1);
  } finally { Date.now = now; }
});

test("cache failures, oversized bodies and disabled caching still serve responses", () => {
  const set = cache.set;
  try {
    cache.set = () => { throw new Error("full"); };
    assert.equal(run(request(), "ok").res.body, "ok");
  } finally { cache.set = set; }
  run(request(), "x".repeat(256 * 1024));
  assert.equal(cache.keys().length, 0);
  run(request(), "cached");
  process.env.CACHE_ENABLED = "false";
  assert.equal(run(request(), "fresh").res.body, "fresh");
});

test("cached objects are detached from controller and response mutations", () => {
  const body = { name: "original" };
  run(request(), body); body.name = "changed";
  const hit = run(request(), null); hit.res.body.name = "also changed";
  assert.equal(run(request(), null).res.body.name, "original");
});

test("TTL must be positive and finite", () => {
  for (const ttl of [0, -1, Infinity, NaN]) assert.throws(() => cacheRoute(ttl), TypeError);
});
