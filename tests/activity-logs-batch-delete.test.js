import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../config/db.js";
import cache from "../config/cache/cache.js";
import { activityLogDateRange } from "../features/activity-logs/activityLogDateRange.js";
import { deleteActivityLogsByDateRange, previewActivityLogBatchDelete } from "../features/activity-logs/controllers/activityLogsControllers.js";

process.env.ACCESS_TOKEN_SECRET = "batch-delete-test-access";
process.env.REFRESH_TOKEN_SECRET = "batch-delete-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "batch-delete-test-temp";
const { default: routes } = await import("../features/activity-logs/routes/activityLogsRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const originalExecute = db.execute;
const originalGetConnection = db.getConnection;
const originalError = console.error;
const dates = { fromDate: "2026-10-01", throughDate: "2026-10-16" };
const bounds = ["2026-10-01 00:00:00", "2026-10-16 23:59:59.999999"];
let calls;
let state;

function response() {
  return {
    statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
  };
}
const request = (range = dates, role = "admin") => ({
  verifiedUser: { id: "admin", role }, query: range, body: range,
});
function seed() {
  for (const [key, path] of [
    ["admin-page", "/activity-logs"], ["filtered-page", "/activity-logs"],
    ["personal-page", "/activity-logs/mine"], ["dashboard", "/admin-dashboard-data"],
    ["profile", "/account/user"],
  ]) cache.set(key, { path: `/api/v1${path}`, body: {} });
}

beforeEach(() => {
  cache.flushAll();
  calls = [];
  state = { acquired: 0, began: 0, committed: 0, rolledBack: 0, released: 0, count: 18 };
  console.error = () => {};
  db.execute = async (sql, params) => {
    calls.push({ sql, params });
    if (state.previewError) throw new Error("count failed");
    return [[{ total: state.count }]];
  };
  db.getConnection = async () => {
    state.acquired++;
    if (state.acquireError) throw new Error("pool unavailable");
    return {
      async beginTransaction() { state.began++; },
      async execute(sql, params) {
        calls.push({ sql, params });
        if (state.deleteError) throw new Error("delete failed");
        return [{ affectedRows: state.count }];
      },
      async commit() {
        assert.ok(cache.has("admin-page"), "cache must remain until commit succeeds");
        if (state.commitError) throw new Error("commit failed");
        state.committed++;
      },
      async rollback() { state.rolledBack++; },
      release() { state.released++; },
    };
  };
});
after(async () => {
  db.execute = originalExecute;
  db.getConnection = originalGetConnection;
  console.error = originalError;
  cache.close();
  await db.end();
});

test("date bounds include both full days, single days, leap days, and year boundaries", () => {
  assert.deepEqual(activityLogDateRange(dates).params, bounds);
  for (const [fromDate, throughDate] of [
    ["2026-10-16", "2026-10-16"], ["2024-02-29", "2024-03-01"],
    ["2025-12-31", "2026-01-01"], ["9999-12-31", "9999-12-31"],
  ]) assert.deepEqual(activityLogDateRange({ fromDate, throughDate }).params,
    [`${fromDate} 00:00:00`, `${throughDate} 23:59:59.999999`]);
});

test("invalid or missing dates never reach a query or a transaction", async () => {
  const invalid = [
    undefined, {}, { fromDate: dates.fromDate }, { throughDate: dates.throughDate },
    { ...dates, fromDate: "2026-02-29" }, { ...dates, throughDate: "2026-04-31" },
    { ...dates, fromDate: "2026-10-17" }, { ...dates, fromDate: "2026-1-01" },
    { ...dates, fromDate: "2026-10-01' OR 1=1 --" }, { ...dates, throughDate: [dates.throughDate] },
    { ...dates, fromDate: "0000-01-01" }, { ...dates, fromDate: "2026-10-01T00:00:00Z" },
  ];
  for (const range of invalid) {
    assert.ok(activityLogDateRange(range).error);
    for (const handler of [previewActivityLogBatchDelete, deleteActivityLogsByDateRange]) {
      const req = request(); req.body = range; req.query = range;
      const res = response(); await handler(req, res);
      assert.equal(res.statusCode, 400);
    }
  }
  assert.equal(calls.length, 0);
  assert.equal(state.acquired, 0);
});

test("only admins can preview or delete, even when invoking controllers directly", async () => {
  for (const role of ["student", "employer", "department_head", null]) {
    for (const handler of [previewActivityLogBatchDelete, deleteActivityLogsByDateRange]) {
      const res = response(); await handler(request(dates, role), res);
      assert.equal(res.statusCode, 403);
    }
  }
  assert.equal(calls.length, 0);
  assert.equal(state.acquired, 0);
});

test("preview is uncached, uses the same bounds, and ignores page filters explicitly", async () => {
  seed();
  const res = response();
  await previewActivityLogBatchDelete(request({ ...dates, search: "restricted", actorRole: "student", page: "9" }), res);
  assert.deepEqual(res.body, { success: true, count: 18 });
  assert.equal(res.headers["Cache-Control"], "private, no-store");
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /WHERE created_at >= \? AND created_at <= \?/);
  assert.deepEqual(calls[0].params, bounds);
  assert.equal(cache.keys().length, 5);
  state.count = 0;
  const empty = response(); await previewActivityLogBatchDelete(request(), empty);
  assert.equal(empty.body.count, 0);
  assert.equal(calls.length, 2);
});

test("batch deletion commits one parameterized range delete then invalidates all log and dashboard views", async () => {
  seed();
  const res = response(); await deleteActivityLogsByDateRange(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.deletedCount, 18);
  assert.equal(res.body.message, "18 activity logs deleted.");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql, "DELETE FROM activity_logs WHERE created_at >= ? AND created_at <= ?");
  assert.deepEqual(calls[0].params, bounds);
  assert.equal(state.began, 1);
  assert.equal(state.committed, 1);
  assert.equal(state.rolledBack, 0);
  assert.equal(state.released, 1);
  assert.deepEqual(cache.keys(), ["profile"]);
});

test("no matching logs is a successful no-op, using affected rows rather than a stale preview count", async () => {
  seed(); state.count = 0;
  const res = response(); await deleteActivityLogsByDateRange(request(), res);
  assert.deepEqual(res.body, { success: true, deletedCount: 0, message: "No activity logs matched this date range." });
  assert.equal(state.released, 1);
});

test("database and commit failures preserve caches and release connections", async () => {
  for (const failure of ["acquireError", "deleteError", "commitError"]) {
    seed(); state[failure] = true;
    const released = state.released;
    const res = response(); await deleteActivityLogsByDateRange(request(), res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, undefined);
    assert.equal(cache.keys().length, 5);
    assert.equal(state.released - released, failure === "acquireError" ? 0 : 1);
    state[failure] = false;
  }
  assert.equal(state.committed, 0);
  assert.equal(state.rolledBack, 2);
  state.previewError = true;
  const res = response(); await previewActivityLogBatchDelete(request(), res);
  assert.equal(res.statusCode, 500);
  assert.equal(cache.keys().length, 5);
});

test("static batch route precedes logId and both endpoints enforce JWT authentication and admin role", () => {
  const stack = routes.stack.filter((layer) => layer.route);
  const singleIndex = stack.findIndex((layer) => layer.route.path === "/activity-logs/:logId");
  for (const path of ["/activity-logs/batch", "/activity-logs/batch-delete-preview"]) {
    const index = stack.findIndex((layer) => layer.route.path === path);
    assert.ok(index >= 0 && index < singleIndex);
    const [authenticate, authorize] = stack[index].route.stack;
    const anonymous = response();
    authenticate.handle({ headers: {} }, anonymous, () => assert.fail("anonymous must not proceed"));
    assert.equal(anonymous.statusCode, 401);
    for (const role of ["student", "employer", "department_head", "admin"]) {
      const req = { headers: { authorization: `Bearer ${signAccessToken({ id: "user", role })}` } };
      const res = response(); let proceeded = false;
      authenticate.handle(req, res, () => authorize.handle(req, res, () => { proceeded = true; }));
      assert.equal(proceeded, role === "admin");
      if (role !== "admin") assert.equal(res.statusCode, 403);
    }
  }
});
