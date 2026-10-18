import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { once } from "node:events";
import express from "express";
import { db } from "../config/db.js";
import { API_PREFIXES, mountApiRoutes } from "../config/api.js";
import { deleteErrorGroup } from "../features/error-tracking/controllers/errorTrackingControllers.js";

process.env.ACCESS_TOKEN_SECRET = "error-delete-test-access";
process.env.REFRESH_TOKEN_SECRET = "error-delete-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "error-delete-test-temp";
const { signAccessToken } = await import("../config/jwt.js");
const { default: routes } = await import("../features/error-tracking/routes/errorTrackingRoutes.js");
const originalExecute = db.execute;
const fingerprint = "b".repeat(64);
const otherFingerprint = "c".repeat(64);
let records;
let calls;
let failure;

beforeEach(() => {
  records = [
    { fingerprint, created_at: "2026-10-01" },
    { fingerprint, created_at: "2026-10-18" },
    { fingerprint: otherFingerprint, created_at: "2026-10-18" },
  ];
  calls = [];
  failure = null;
  db.execute = async (sql, params) => {
    calls.push({ sql, params });
    if (failure) throw failure;
    assert.equal(sql, "DELETE FROM error_events WHERE fingerprint = ?");
    const before = records.length;
    records = records.filter(record => record.fingerprint !== params[0]);
    return [{ affectedRows: before - records.length }];
  };
});
after(async () => { db.execute = originalExecute; await db.end(); });

function response() {
  return {
    statusCode: 200, headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
function request(overrides = {}) {
  return { verifiedUser: { id: "admin", role: "admin" }, params: { fingerprint }, ...overrides };
}

test("confirmed group deletion removes its whole history and preserves other groups", async () => {
  const res = response();
  await deleteErrorGroup(request({ query: { days: "1", source: "http" } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, message: "Error group deleted.", deletedOccurrences: 2 });
  assert.equal(res.headers["Cache-Control"], "private, no-store");
  assert.deepEqual(calls, [{ sql: "DELETE FROM error_events WHERE fingerprint = ?", params: [fingerprint] }]);
  assert.deepEqual(records.map(record => record.fingerprint), [otherFingerprint]);
});

test("non-admin callers cannot delete error records even when invoking the controller directly", async () => {
  for (const role of ["student", "employer", "department_head", undefined]) {
    const res = response();
    await deleteErrorGroup(request({ verifiedUser: role ? { id: "viewer", role } : undefined }), res);
    assert.equal(res.statusCode, 403);
  }
  assert.equal(calls.length, 0);
  assert.equal(records.length, 3);
});

test("invalid fingerprints are rejected before any database call", async () => {
  for (const value of ["", "invalid", "b".repeat(63), "B".repeat(64), "b".repeat(64) + "' OR 1=1", null, [fingerprint]]) {
    const res = response();
    await deleteErrorGroup(request({ params: { fingerprint: value } }), res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(calls.length, 0);
});

test("deleting a missing or already deleted group reports not found", async () => {
  await deleteErrorGroup(request(), response());
  const res = response();
  await deleteErrorGroup(request(), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Error group not found.");
  assert.equal(records.length, 1);
});

test("database failures preserve records and return safe errors", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const [code, status] of [["ETIMEDOUT", 500], ["ER_NO_SUCH_TABLE", 503]]) {
      failure = Object.assign(new Error("sensitive connection details"), { code });
      const res = response();
      await deleteErrorGroup(request(), res);
      assert.equal(res.statusCode, status);
      assert.ok(!JSON.stringify(res.body).includes("sensitive"));
      assert.equal(records.length, 3);
    }
  } finally { console.error = originalError; }
});

test("DELETE routes authenticate and authorize both API prefixes without exposing a delete-all endpoint", async t => {
  const app = express();
  mountApiRoutes(app, [routes]);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const send = (prefix, role, suffix = "/" + fingerprint) => fetch(`http://127.0.0.1:${server.address().port}${prefix}/errors${suffix}`, {
    method: "DELETE",
    headers: role ? { Authorization: `Bearer ${signAccessToken({ id: "delete-route-viewer", role })}` } : {},
  });
  for (const prefix of API_PREFIXES) {
    assert.equal((await send(prefix)).status, 401);
    for (const role of ["student", "employer", "department_head"]) assert.equal((await send(prefix, role)).status, 403);
    assert.equal((await send(prefix, "admin", "/invalid")).status, 400);
    assert.equal((await send(prefix, "admin", "")).status, 404);
    assert.equal(calls.length, 0);
    records.push({ fingerprint });
    const res = await send(prefix, "admin");
    assert.equal(res.status, 200);
    assert.equal((await res.json()).success, true);
    calls.length = 0;
  }
});
