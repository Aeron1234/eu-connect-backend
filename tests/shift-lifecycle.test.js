import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { clockOut, getLatestDtrStatus, startBreak, resumeDuty } from "../controllers/dtrControllers.js";
import { getStudentDashboardData } from "../controllers/dashboardController.js";
import { autoCloseStaleShifts } from "../config/autoCloseStaleShifts.js";

const originalGetConnection = db.getConnection;
const originalMaxShiftHours = process.env.MAX_SHIFT_HOURS;
const originalBatchSize = process.env.BATCH_SIZE;

beforeEach(() => {
  process.env.MAX_SHIFT_HOURS = "8";
  process.env.BATCH_SIZE = "100";
});

after(async () => {
  db.getConnection = originalGetConnection;
  if (originalMaxShiftHours === undefined) delete process.env.MAX_SHIFT_HOURS;
  else process.env.MAX_SHIFT_HOURS = originalMaxShiftHours;
  if (originalBatchSize === undefined) delete process.env.BATCH_SIZE;
  else process.env.BATCH_SIZE = originalBatchSize;
  await db.end();
});

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("clock-out at and beyond the cap returns success after committing numeric hours", async () => {
  for (const [rawHours, expectedFlagged] of [[8, false], [8.5, true]]) {
    let committed = false;
    let rolledBack = false;
    const writes = [];
    db.getConnection = async () => ({
      async beginTransaction() {},
      async commit() { committed = true; },
      async rollback() { rolledBack = true; },
      release() {},
      async execute(sql, params) {
        if (sql.includes("FROM daily_time_records dtr")) {
          assert.match(sql, /FOR UPDATE/);
          return [[{ dtr_id: 1, internship_id: "internship", clock_in: "2026-10-03 08:00:00", company_lat: 14, company_lon: 121 }]];
        }
        if (sql.includes("TIMESTAMPDIFF")) return [[{ hours: rawHours }]];
        writes.push({ sql, params });
        return [{ affectedRows: 1 }];
      },
    });

    const res = response();
    await clockOut({ verifiedUser: { id: "student" }, body: { lat_out: 14, lon_out: 121 } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.shiftHours, "8.00");
    assert.equal(res.body.flagged, expectedFlagged);
    assert.equal(committed, true);
    assert.equal(rolledBack, false);
    assert.equal(writes[0].params[2], 8);
    assert.equal(writes[0].params[3], expectedFlagged);
    assert.equal(writes[1].params[0], 8);
  }
});

test("start and resume keep one open shift and accumulate break seconds in database time", async () => {
  for (const [action, status, startedAt, expectedStatus, sqlPattern] of [
    [startBreak, "present", null, "ON_BREAK", /break_started_at = NOW\(\)/],
    [resumeDuty, "on-break", "2026-10-03 12:00:00", "CLOCKED_IN", /TIMESTAMPDIFF\(SECOND, break_started_at, NOW\(\)\)/],
  ]) {
    const writes = [];
    let committed = false;
    db.getConnection = async () => ({
      async beginTransaction() {}, async rollback() {}, release() {},
      async commit() { committed = true; },
      async execute(sql, params) {
        if (sql.trim().startsWith("SELECT")) return [[{ id: 1, clock_in: "2026-10-03 08:00:00", status, break_started_at: startedAt }]];
        writes.push({ sql, params });
        return [{ affectedRows: 1 }];
      },
    });
    const res = response();
    await action({ verifiedUser: { id: "student" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, expectedStatus);
    assert.equal(committed, true);
    assert.equal(writes.length, 1);
    assert.match(writes[0].sql, sqlPattern);
    assert.deepEqual(writes[0].params, [1]);
  }
});

test("duplicate or out-of-order break requests cannot change a shift", async () => {
  for (const [action, status, startedAt] of [
    [startBreak, "on-break", "2026-10-03 12:00:00"],
    [resumeDuty, "present", null],
  ]) {
    let writes = 0;
    db.getConnection = async () => ({
      async beginTransaction() {}, async commit() { throw new Error("Should not commit"); },
      async rollback() {}, release() {},
      async execute(sql) {
        if (sql.trim().startsWith("SELECT")) return [[{ id: 1, clock_in: "2026-10-03 08:00:00", status, break_started_at: startedAt }]];
        writes++;
        return [{ affectedRows: 1 }];
      },
    });
    const res = response();
    await action({ verifiedUser: { id: "student" } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(writes, 0);
  }
});

test("break actions reject requests without an active clock-in", async () => {
  for (const action of [startBreak, resumeDuty]) {
    for (const rows of [[], [{ id: 1, clock_in: null, status: "present", break_started_at: null }]]) {
      let writes = 0;
      let rolledBack = false;
      db.getConnection = async () => ({
        async beginTransaction() {},
        async commit() { throw new Error("A missing clock-in must not commit"); },
        async rollback() { rolledBack = true; },
        release() {},
        async execute(sql) {
          if (sql.trim().startsWith("SELECT")) {
            assert.match(sql, /clock_in IS NOT NULL AND clock_out IS NULL/);
            return [rows];
          }
          writes++;
          return [{ affectedRows: 1 }];
        },
      });
      const res = response();
      await action({ verifiedUser: { id: "student" } }, res);
      assert.equal(res.statusCode, 404);
      assert.match(res.body.error, /Clock in first/);
      assert.equal(writes, 0);
      assert.equal(rolledBack, true);
    }
  }
});

test("manual clock-out excludes completed lunch and rejects an active break", async () => {
  for (const onBreak of [false, true]) {
    const writes = [];
    db.getConnection = async () => ({
      async beginTransaction() {}, async rollback() {}, async commit() {}, release() {},
      async execute(sql, params) {
        if (sql.includes("FROM daily_time_records dtr")) return [[{
          dtr_id: 1, internship_id: "internship", clock_in: "2026-10-03 08:00:00",
          company_lat: 14, company_lon: 121, status: onBreak ? "on-break" : "present",
          break_started_at: onBreak ? "2026-10-03 12:00:00" : null,
          break_total_seconds: 3600,
        }]];
        if (sql.includes("TIMESTAMPDIFF")) {
          assert.match(sql, /TIMESTAMPDIFF\(SECOND, \?, NOW\(\)\) - \?/);
          assert.deepEqual(params, ["2026-10-03 08:00:00", 3600]);
          return [[{ hours: 8 }]];
        }
        writes.push({ sql, params });
        return [{ affectedRows: 1 }];
      },
    });
    const res = response();
    await clockOut({ verifiedUser: { id: "student" }, body: { lat_out: 14, lon_out: 121 } }, res);
    assert.equal(res.statusCode, onBreak ? 409 : 200);
    assert.equal(writes.length, onBreak ? 0 : 2);
    if (!onBreak) assert.equal(res.body.shiftHours, "8.00");
  }
});

test("live DTR status exposes an active break without closing the shift", async () => {
  db.getConnection = async () => ({
    release() {},
    async execute(sql) {
      assert.match(sql, /clock_out, status/);
      return [[{ id: 1, clock_in: "2026-10-03 08:00:00", clock_out: null, status: "on-break" }]];
    },
  });
  const res = response();
  await getLatestDtrStatus({ verifiedUser: { id: "student" }, query: { internshipId: "internship" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, "ON_BREAK");
});

test("status and dashboard do not treat a row without clock-in as an active shift", async () => {
  db.getConnection = async () => ({
    release() {},
    async execute(sql) {
      if (sql.includes("FROM internship_records")) {
        return [[{ id: "internship", status: "ongoing" }]];
      }
      if (sql.includes("FROM daily_time_records") && sql.includes("ORDER BY id DESC")) {
        return [[{ id: 1, clock_in: null, clock_out: null, status: "present" }]];
      }
      return [[]];
    },
  });
  const req = { verifiedUser: { id: "student" }, query: { internshipId: "internship" } };
  const statusRes = response();
  await getLatestDtrStatus(req, statusRes);
  assert.equal(statusRes.body.status, "CLOCKED_OUT");

  const dashboardRes = { ...response(), locals: {} };
  await getStudentDashboardData(req, dashboardRes);
  assert.equal(dashboardRes.statusCode, 200);
  assert.equal(dashboardRes.body.dtrStatus.status, "CLOCKED_OUT");
});

test("auto-close at eight hours records a present shift and credits hours once", async () => {
  const queries = [];
  let connections = 0;
  let committed = false;
  db.getConnection = async () => {
    connections++;
    if (connections === 1) return {
      release() {},
      async execute(sql, params) {
        assert.match(sql, /break_total_seconds/);
        assert.deepEqual(params, [28800, 10]);
        return [[{ id: 1, internship_id: "internship" }]];
      },
    };
    return {
      async beginTransaction() {}, async rollback() {}, release() {},
      async commit() { committed = true; },
      async execute(sql, params) {
        queries.push({ sql, params });
        return [{ affectedRows: 1 }];
      },
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.trim().startsWith("SELECT")) return [[{ id: 1, internship_id: "internship", worked_seconds: 28800, break_total_seconds: 0 }]];
        return [{ affectedRows: 1 }];
      },
    };
  };
  const log = console.log;
  try {
    console.log = () => {};
    await autoCloseStaleShifts();
  } finally { console.log = log; }

  assert.equal(committed, true);
  assert.match(queries[0].sql, /FOR UPDATE/);
  assert.match(queries[1].sql, /status = 'present'/);
  assert.match(queries[1].sql, /auto_closed = 1/);
  assert.deepEqual(queries[1].params, [true, 28800, 8, true, 28800, 1]);
  assert.deepEqual(queries[2].params, [8, "internship"]);
});

test("auto-close stops a forgotten break at the wall limit without crediting break time", async () => {
  let connections = 0;
  const updates = [];
  let committed = false;
  db.getConnection = async () => {
    connections++;
    if (connections === 1) return {
      release() {},
      async execute(sql, params) {
        assert.deepEqual(params, [28800, 10]);
        return [[{ id: 1, internship_id: "internship" }]];
      },
    };
    return {
      async beginTransaction() {}, async rollback() {}, release() {},
      async commit() { committed = true; },
      async query(sql) {
        if (sql.trim().startsWith("SELECT")) return [[{
          id: 1, internship_id: "internship", worked_seconds: 14400,
          break_total_seconds: 0, break_started_at: "2026-10-03 12:00:00",
        }]];
        return [{ affectedRows: 1 }];
      },
      async execute(sql, params) {
        updates.push({ sql, params });
        return [{ affectedRows: 1 }];
      },
    };
  };
  const log = console.log;
  try {
    console.log = () => {};
    await autoCloseStaleShifts();
  } finally { console.log = log; }
  assert.equal(committed, true);
  assert.match(updates[0].sql, /break_started_at = NULL/);
  assert.deepEqual(updates[0].params, [false, 28800, 4, false, 28800, 1]);
});

test("auto-close does not overwrite a shift manually closed after its initial scan", async () => {
  let connections = 0;
  let mutations = 0;
  let rolledBack = false;
  db.getConnection = async () => {
    connections++;
    if (connections === 1) return {
      release() {},
      async execute() { return [[{ id: 1, internship_id: "internship" }]]; },
    };
    return {
      async beginTransaction() {},
      async commit() { throw new Error("Empty batch should not commit"); },
      async rollback() { rolledBack = true; },
      release() {},
      async query(sql) {
        if (sql.trim().startsWith("SELECT")) return [[]];
        mutations++;
        return [{ affectedRows: 1 }];
      },
    };
  };
  const log = console.log;
  try {
    console.log = () => {};
    await autoCloseStaleShifts();
  } finally { console.log = log; }
  assert.equal(rolledBack, true);
  assert.equal(mutations, 0);
});
