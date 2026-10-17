import { test, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { mountApiRoutes } from "../config/api.js";
import { db } from "../config/db.js";
import { errorTrackingContext, reportError } from "../config/errorTracking.js";

process.env.ACCESS_TOKEN_SECRET = "test-only-access-secret";
process.env.REFRESH_TOKEN_SECRET = "test-only-refresh-secret";
const { signAccessToken } = await import("../config/jwt.js");
const { default: routes } = await import("../features/error-tracking/routes/errorTrackingRoutes.js");
const originalExecute = db.execute;
const originalQuery = db.query;
const writes = [];
const fingerprint = "a".repeat(64);

db.execute = async (sql, params = []) => {
  if (sql.includes("INSERT INTO error_events")) {
    writes.push(params);
    return [{ affectedRows: 1 }];
  }
  if (sql.includes("COUNT(DISTINCT fingerprint)")) {
    return [[{ total_occurrences: 2, total_groups: 1 }]];
  }
  if (sql.includes("GROUP BY fingerprint")) {
    return [[{ fingerprint, latest_id: 2, occurrences: 2,
      first_seen: "2026-10-01", last_seen: "2026-10-02" }]];
  }
  if (sql.includes("COUNT(*) AS count")) {
    return [[{ count: 2, first_seen: "2026-10-01", last_seen: "2026-10-02" }]];
  }
  if (sql.includes("FROM error_events WHERE fingerprint")) {
    return [[{ id: 2, request_id: "request-id", method: "GET", route_pattern: "/test",
      message: "Database unavailable", created_at: "2026-10-02" }]];
  }
  throw new Error(`Unexpected SQL: ${sql}`);
};
db.query = async () => [[{ id: 2, method: "GET", route_pattern: "/test", message: "Database unavailable" }]];

after(async () => {
  db.execute = originalExecute;
  db.query = originalQuery;
  await db.end();
});

async function client(t) {
  const app = express();
  app.use(errorTrackingContext);
  app.use("/api/v1", routes);
  const mounted = express.Router();
  mounted.get("/mounted/:id", (_req, res) => {
    reportError("Mounted route failed:", new Error("Database unavailable"));
    res.status(500).json({ error: "Unavailable" });
  });
  mountApiRoutes(app, [mounted]);
  app.get("/fail/:id", (req, res) => {
    reportError("Database query failed:", new Error("secret@example.com Bearer abc123"));
    res.status(500).json({ error: "Unavailable" });
  });
  app.get("/plain-fail", (_req, res) => res.status(503).json({ error: "Unavailable" }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return (path, role, method = "GET") => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: role ? { Authorization: `Bearer ${signAccessToken({ id: "viewer", role })}` } : {},
  });
}

test("error API is read-only and restricted to admins", async (t) => {
  const get = await client(t);
  assert.equal((await get("/api/v1/errors")).status, 401);
  assert.equal((await get("/api/v1/errors", "student")).status, 403);
  const response = await get("/api/v1/errors?days=7", "admin");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.stats.totalGroups, 1);
  assert.equal(data.data[0].occurrences, 2);
  assert.equal((await get(`/api/v1/errors/${fingerprint}`, "admin")).status, 200);
  assert.equal((await get("/api/v1/errors/invalid", "admin")).status, 400);
  assert.equal((await get("/api/v1/errors", "admin", "POST")).status, 404);
  assert.equal((await get("/api/v1/unknown")).status, 404);
});

test("a 5xx response is recorded even without a controller error log", async (t) => {
  const get = await client(t);
  writes.length = 0;
  assert.equal((await get("/plain-fail")).status, 503);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 1);
  assert.equal(writes[0][4], "/plain-fail");
  assert.equal(writes[0][5], 503);
});

test("caught failures retain a request ID and safe route pattern", async (t) => {
  const get = await client(t);
  writes.length = 0;
  const response = await get("/fail/42");
  assert.equal(response.status, 500);
  assert.match(response.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 1);
  assert.equal(writes[0][4], "/fail/:id");
  assert.equal(writes[0][5], 500);
  assert.ok(!writes[0][9].includes("Bearer abc123"));
  assert.ok(!writes[0][9].includes("secret@example.com"));
});

test("mounted API paths retain their route template", async (t) => {
  const get = await client(t);
  writes.length = 0;
  assert.equal((await get("/api/v1/mounted/123", "admin")).status, 500);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes[0][4], "/api/v1/mounted/:id");
});

test("legacy API errors use the canonical route pattern and fingerprint", async (t) => {
  const get = await client(t);
  writes.length = 0;
  for (const prefix of ["/api/v1", "/eu-connect/api"]) {
    assert.equal((await get(`${prefix}/mounted/123`, "admin")).status, 500);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 2);
  assert.ok(writes.every(write => write[4] === "/api/v1/mounted/:id"));
  assert.equal(writes[0][0], writes[1][0]);
});
