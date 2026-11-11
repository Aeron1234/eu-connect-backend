import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { db } from "../config/db.js";
import { supabase } from "../config/supabase.js";
import { clockIn, clockOut, deleteDTR, getTodayDTR, getLatestDtrStatus, startBreak, resumeDuty, getDtrPhoto } from "../features/dtr/controllers/dtrControllers.js";
import { uploadDtrPhoto } from "../features/dtr/dtrPhoto.js";
import { getStudentDashboardData } from "../features/dashboard/controllers/dashboardController.js";
import { autoCloseStaleShifts, warnLongShifts } from "../config/autoCloseStaleShifts.js";
import { requestOvertime, reviewAutoClosedDtr, submitAutoCloseExplanation, reportMissedClockOut } from "../features/dtr/controllers/dtrReviewController.js";

const originalGetConnection = db.getConnection;
const originalMaxShiftHours = process.env.MAX_SHIFT_HOURS;
const originalBatchSize = process.env.BATCH_SIZE;
const originalStorageFrom = supabase.storage.from;
const photo = { buffer: await sharp({ create: { width: 320, height: 240, channels: 3, background: "white" } }).jpeg().toBuffer() };
supabase.storage.from = () => ({
  async upload() { return { error: null }; },
  async remove() { return { error: null }; },
});

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
  supabase.storage.from = originalStorageFrom;
  await db.end();
});

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  set(key, value) { this.headers ??= {}; this.headers[key] = value; return this; },
  json(body) { this.body = body; return this; },
});

test("the saved image has a visible band derived from the supplied database time", async () => {
  const from = supabase.storage.from;
  const uploads = [];
  supabase.storage.from = () => ({ async upload(path, bytes, options) { uploads.push({ path, bytes, options }); return { error: null }; } });
  try {
    const first = await uploadDtrPhoto(photo, "2026-11-05 08:00:00", "in", "student");
    await uploadDtrPhoto(photo, "2026-11-05 08:01:00", "in", "student");
    assert.match(first, /^dtr\/student\/.+-in\.jpg$/);
    assert.equal(uploads[0].options.contentType, "image/jpeg");
    assert.notDeepEqual(uploads[0].bytes, uploads[1].bytes);
    const top = await sharp(uploads[0].bytes).extract({ left: 1, top: 1, width: 1, height: 1 }).raw().toBuffer();
    const bottom = await sharp(uploads[0].bytes).extract({ left: 1, top: 230, width: 1, height: 1 }).raw().toBuffer();
    assert.ok(top[0] > 200 && bottom[0] < 100, "watermark band is burned into the JPEG");
  } finally { supabase.storage.from = from; }
});

test("photo access checks the DTR owner and supervisor before signing", async () => {
  const from = supabase.storage.from;
  let signed = 0;
  supabase.storage.from = () => ({ async createSignedUrl() { signed++; return { data: { signedUrl: "https://example.test/private" }, error: null }; } });
  db.getConnection = async () => ({
    release() {},
    async execute(sql) {
      if (sql.includes("FROM daily_time_records dtr")) return [[{
        internship_id: "internship", user_id: "student", employer_id: "supervisor", deleted_at: null,
        clock_in_photo_path: "dtr/student/in.jpg", clock_out_photo_path: null,
      }]];
      throw new Error("Unexpected SQL");
    },
  });
  try {
    const denied = response();
    await getDtrPhoto({ params: { dtrId: "1", kind: "in" }, verifiedUser: { id: "other", role: "employer" } }, denied);
    assert.equal(denied.statusCode, 403);
    assert.equal(signed, 0);
    const allowed = response();
    await getDtrPhoto({ params: { dtrId: "1", kind: "in" }, verifiedUser: { id: "supervisor", role: "employer" } }, allowed);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.body.url, "https://example.test/private");
    assert.equal(allowed.headers["Cache-Control"], "private, no-store");
    const legacy = response();
    await getDtrPhoto({ params: { dtrId: "1", kind: "out" }, verifiedUser: { id: "student", role: "student" } }, legacy);
    assert.equal(legacy.statusCode, 404);
  } finally { supabase.storage.from = from; }
});

test("clock-in and clock-out reject an internship before its start date", async () => {
  for (const action of [clockIn, clockOut]) {
    let rolledBack = false;
    let wrote = false;
    db.getConnection = async () => ({
      async beginTransaction() {},
      async rollback() { rolledBack = true; },
      async commit() { wrote = true; },
      release() {},
      async execute(sql) {
        if (sql.includes("SELECT id FROM users")) return [[{ id: "student" }]];
        if (sql.includes("SELECT id FROM daily_time_records")) return [[]];
        if (sql.includes("DATE(clock_in) = CURDATE()")) return [[]];
        if (sql.includes("FROM internship_records ir") || sql.includes("FROM daily_time_records dtr")) {
          return [[{ internship_id: "internship", dtr_id: 1, date_started: "2099-01-01", has_started: 0 }]];
        }
        wrote = true;
        return [{ affectedRows: 1 }];
      },
    });
    const res = response();
    await action({ verifiedUser: { id: "student", role: "student" }, file: photo, body: { lat_in: 14, lon_in: 121, lat_out: 14, lon_out: 121 } }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /start date/i);
    assert.equal(rolledBack, true);
    assert.equal(wrote, false);
  }
});

test("student clock actions require a readable photo before attendance is changed", async () => {
  let connections = 0;
  db.getConnection = async () => { connections++; throw new Error("Photo validation should precede database access"); };
  for (const action of [clockIn, clockOut]) {
    const missing = response();
    await action({ verifiedUser: { id: "student", role: "student" }, body: { lat_in: 14, lon_in: 121, lat_out: 14, lon_out: 121 } }, missing);
    assert.equal(missing.statusCode, 400);
    assert.match(missing.body.error, /photo/i);
    const invalid = response();
    await action({ verifiedUser: { id: "student", role: "student" }, file: { buffer: Buffer.from("not an image") }, body: { lat_in: 14, lon_in: 121, lat_out: 14, lon_out: 121 } }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.body.error, /retake/i);
  }
  assert.equal(connections, 0);
});

test("one Manila start date and six-hour rest work for day and overnight shifts", async () => {
  for (const [lastShift, expectedStatus, message] of [
    [{ started_today: 1, seconds_since_clock_out: 36000 }, 409, /attendance already exists/i],
    [{ started_today: 0, seconds_since_clock_out: 300 }, 409, /six hours/i],
    [{ started_today: 0, seconds_since_clock_out: 16 * 3600 }, 201, /successful/i],
    [null, 201, /successful/i],
  ]) {
    let committed = false;
    let rolledBack = false;
    db.getConnection = async () => ({
      async beginTransaction() {},
      async commit() { committed = true; },
      async rollback() { rolledBack = true; },
      release() {},
      async execute(sql, params) {
        if(sql.includes('FROM dtr_weekly_schedules'))return [[{id:1,source:'student',working_days:'[0,1,2,3,4,5,6]',clock_in_time:'08:00',clock_out_time:'18:00',effective_from:'2026-11-01'}]];
        if(sql.includes('COUNT(*) AS total'))return [[{total:lastShift?.started_today?1:0}]];
        if(sql.includes('FROM dtr_absence_reports'))return [[]];
        if (sql.includes("SELECT id FROM users")) {
          assert.match(sql, /FOR UPDATE/);
          assert.deepEqual(params, ["student"]);
          return [[{ id: "student" }]];
        }
        if (sql.includes("SELECT id FROM daily_time_records")) return [[]];
        if (sql.includes("DATE(clock_in) = CURDATE()")) {
          assert.match(sql, /TIMESTAMPDIFF\(SECOND, COALESCE\(claimed_clock_out_at, clock_out\), NOW\(\)\)/);
          return [lastShift ? [lastShift] : []];
        }
        if (sql.includes("FROM internship_records ir")) {
          return [[{ internship_id: "internship", date_started: "2026-11-01", has_started: 1,
            company_lat: 14, company_lon: 121 }]];
        }
        if (sql.includes("DATE_FORMAT(NOW()")) return [[{ recorded_at: "2026-11-05 08:00:00" }]];
        if (sql.includes("INSERT INTO daily_time_records")) return [{ affectedRows: 1 }];
        throw new Error("Unexpected SQL: " + sql);
      },
    });
    const res = response();
    await clockIn({ verifiedUser: { id: "student", role: "student" }, file: photo, query: { internshipId: "internship" },
      body: { lat_in: 14, lon_in: 121 } }, res);
    assert.equal(res.statusCode, expectedStatus);
    assert.match(res.body.error || res.body.message, message);
    assert.equal(committed, expectedStatus === 201);
    assert.equal(rolledBack, expectedStatus !== 201);
  }
});

test("an older unexplained auto-close blocks clock-in even after a newer shift", async () => {
  let reachedLatestShift = false;
  let rolledBack = false;
  db.getConnection = async () => ({
    async beginTransaction() {}, async rollback() { rolledBack = true; },
    async commit() { throw new Error("Blocked clock-in must not commit"); }, release() {},
    async execute(sql) {
      if (sql.includes("SELECT id FROM users")) return [[{ id: "student" }]];
      if (sql.includes("clock_out IS NULL")) return [[]];
      if (sql.includes("auto_close_review_status = 'pending_explanation'")) return [[{ id: 23 }]];
      if (sql.includes("DATE(clock_in) = CURDATE()")) reachedLatestShift = true;
      throw new Error("Unexpected SQL: " + sql);
    },
  });
  const res = response();
  await clockIn({ verifiedUser: { id: "student", role: "student" }, file: photo,
    body: { lat_in: 14, lon_in: 121 } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.dtrId, 23);
  assert.equal(rolledBack, true);
  assert.equal(reachedLatestShift, false);
});

test("the Today lookup keeps an overnight shift visible after midnight", async () => {
  const overnight = { id: 1, clock_in: "2026-11-03 22:00:00", clock_out: "2026-11-04 06:00:00" };
  db.getConnection = async () => ({
    release() {},
    async execute(sql, params) {
      assert.match(sql, /clock_out >= CURDATE\(\)/);
      assert.match(sql, /clock_out IS NULL/);
      assert.deepEqual(params, ["student", "internship"]);
      return [[overnight]];
    },
  });
  const res = response();
  await getTodayDTR({ verifiedUser: { id: "student" }, query: { internshipId: "internship" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, overnight);
});

test("recent or open DTR rows cannot be deleted to bypass the next clock-in rule", async () => {
  for (const [record, expectedStatus] of [
    [{ clock_in: "2026-11-04 08:00:00", clock_out: null, started_today: 1, seconds_since_clock_out: null }, 409],
    [{ clock_in: "2026-11-04 08:00:00", clock_out: "2026-11-04 10:00:00", started_today: 1, seconds_since_clock_out: 36000 }, 409],
    [{ clock_in: "2026-11-03 22:00:00", clock_out: "2026-11-04 06:00:00", started_today: 0, seconds_since_clock_out: 300 }, 409],
    [{ clock_in: "2026-11-03 08:00:00", clock_out: "2026-11-03 10:00:00", started_today: 0, seconds_since_clock_out: 36000 }, 200],
    [{ clock_in: null, clock_out: null, started_today: null, seconds_since_clock_out: null }, 200],
  ]) {
    let committed = false;
    let rolledBack = false;
    let writes = 0;
    db.getConnection = async () => ({
      release() {},
      async beginTransaction() {},
      async commit() { committed = true; },
      async rollback() { rolledBack = true; },
      async execute(sql, params) {
        assert.deepEqual(params, [1, "student"]);
        if (sql.includes("SELECT clock_in, clock_out")) return [[record]];
        writes++;
        if (sql.includes("DELETE FROM daily_time_records")) return [{ affectedRows: 1 }];
        return [{ affectedRows: 1 }];
      },
    });
    const res = response();
    await deleteDTR({ verifiedUser: { id: "student" }, params: { dtrId: 1 } }, res);
    assert.equal(res.statusCode, expectedStatus);
    assert.equal(committed, expectedStatus === 200);
    assert.equal(rolledBack, expectedStatus === 409);
    assert.equal(writes, expectedStatus === 200 ? 2 : 0);
  }
});

test("deleting an eligible DTR queues and removes both private photos after commit", async () => {
  const originalFrom = supabase.storage.from;
  const removed = [];
  let committed = false;
  supabase.storage.from = () => ({ async remove(paths) {
    assert.equal(committed, true);
    removed.push(...paths);
    return { error: null };
  } });
  db.getConnection = async () => ({
    release() {}, async beginTransaction() {}, async rollback() {},
    async commit() { committed = true; },
    async execute(sql, params) {
      if (sql.includes("SELECT clock_in, clock_out")) return [[{
        clock_in: "2026-11-01 08:00:00", clock_out: "2026-11-01 17:00:00",
        clock_in_photo_path: "dtr/in.jpg", clock_out_photo_path: "dtr/out.jpg",
        started_today: 0, seconds_since_clock_out: 86400, auto_closed: 0,
      }]];
      if (sql.includes("SELECT id, storage_path FROM dtr_photo_cleanup")) return [[
        { id: "in-id", storage_path: "dtr/in.jpg" }, { id: "out-id", storage_path: "dtr/out.jpg" },
      ]];
      return [{ affectedRows: 1 }];
    },
  });
  try {
    const res = response();
    await deleteDTR({ verifiedUser: { id: "student" }, params: { dtrId: 1 } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(removed, ["dtr/in.jpg", "dtr/out.jpg"]);
  } finally { supabase.storage.from = originalFrom; }
});

test("a reported missed clock-out closes without credit and alerts authorized staff", async () => {
  const statements = [];
  let committed = false;
  db.getConnection = async () => ({
    release() {}, async beginTransaction() {}, async rollback() {},
    async commit() { committed = true; },
    async execute(sql, params) {
      statements.push({ sql, params });
      if (sql.includes("SELECT id FROM users")) return [[{ id: "student" }]];
      if (sql.includes("FROM daily_time_records dtr")) return [[{
        id: 8, internship_id: "internship", break_total_seconds: 0,
        expected_clock_out: null, claimed_seconds: 6 * 3600,
        seconds_since_claim: 7 * 3600, active_break_seconds: null,
        employer_id: "employer", company_name: "Hospital",
      }]];
      if (sql.includes("SELECT DISTINCT hd.user_id")) return [[{ user_id: "head" }]];
      return [{ affectedRows: 1 }];
    },
  });
  const res = response();
  await reportMissedClockOut({
    verifiedUser: { id: "student", role: "student" },
    body: { explanation: "I forgot to clock out after my shift.", claimedEnd: "2026-11-07T17:00" },
    app: { get: () => ({ to: () => ({ emit() {} }) }) },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(committed, true);
  const update = statements.find(item => item.sql.includes("SET clock_out = NOW(), auto_closed_at = NOW()"));
  assert.match(update.sql, /total_hours = 0/);
  assert.match(update.sql, /auto_close_review_status = 'pending_review'/);
  assert.equal(update.params[2], 6);
  assert.equal(update.params[4], 1); // no schedule and under seven hours
  assert.equal(statements.filter(item => item.sql.includes("INSERT INTO notifications")).length, 2);
  assert.equal(statements.some(item => item.sql.includes("UPDATE internship_records SET accumulated_hours")), false);
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
          return [[{ dtr_id: 1, internship_id: "internship", clock_in: "2026-10-03 08:00:00", company_lat: 14, company_lon: 121, date_started: "2026-10-01", has_started: 1 }]];
        }
        if (sql.includes("TIMESTAMPDIFF")) return [[{ hours: rawHours }]];
        if (sql.includes("DATE_FORMAT(NOW()")) return [[{ recorded_at: "2026-11-05 17:00:00" }]];
        writes.push({ sql, params });
        return [{ affectedRows: 1 }];
      },
    });

    const res = response();
    await clockOut({ verifiedUser: { id: "student", role: "student" }, file: photo, body: { lat_out: 14, lon_out: 121 } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.shiftHours, "8.00");
    assert.equal(res.body.flagged, expectedFlagged);
    assert.equal(committed, true);
    assert.equal(rolledBack, false);
    assert.equal(writes[0].params[4], 8);
    assert.equal(writes[0].params[5], expectedFlagged);
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
          company_lat: 14, company_lon: 121, date_started: "2026-10-01", has_started: 1, status: onBreak ? "on-break" : "present",
          break_started_at: onBreak ? "2026-10-03 12:00:00" : null,
          break_total_seconds: 3600,
        }]];
        if (sql.includes("TIMESTAMPDIFF")) {
          assert.match(sql, /TIMESTAMPDIFF\(SECOND, \?, NOW\(\)\) - \?/);
          assert.deepEqual(params, ["2026-10-03 08:00:00", 3600]);
          return [[{ hours: 8 }]];
        }
        if (sql.includes("DATE_FORMAT(NOW()")) return [[{ recorded_at: "2026-11-05 17:00:00" }]];
        writes.push({ sql, params });
        return [{ affectedRows: 1 }];
      },
    });
    const res = response();
    await clockOut({ verifiedUser: { id: "student", role: "student" }, file: photo, body: { lat_out: 14, lon_out: 121 } }, res);
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

test("auto-close at sixteen wall hours proposes duty without crediting it", async () => {
  process.env.MAX_SHIFT_HOURS = "10";
  const queries = [];
  let connections = 0;
  let committed = false;
  db.getConnection = async () => {
    connections++;
    if (connections === 1) return {
      release() {},
      async execute(sql, params) {
        assert.match(sql, /clock_in <= DATE_SUB\(NOW\(\), INTERVAL \? HOUR\)/);
        assert.deepEqual(params, [16]);
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
        if (sql.trim().startsWith("SELECT")) return [[{ id: 1, user_id: "student", internship_id: "internship", worked_seconds: 16 * 3600, break_total_seconds: 0 }]];
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
  assert.match(queries[1].sql, /total_hours = 0/);
  assert.match(queries[1].sql, /pending_explanation/);
  assert.deepEqual(queries[1].params, [10, 1]);
  assert.match(queries[2].sql, /INSERT INTO notifications/);
  assert.deepEqual(queries[2].params, ["student", "internship"]);
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
        assert.deepEqual(params, [16]);
        return [[{ id: 1, internship_id: "internship" }]];
      },
    };
    return {
      async beginTransaction() {}, async rollback() {}, release() {},
      async commit() { committed = true; },
      async query(sql) {
        if (sql.trim().startsWith("SELECT")) return [[{
          id: 1, user_id: "student", internship_id: "internship", worked_seconds: 14400,
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
  assert.deepEqual(updates[0].params, [4, 1]);
  assert.match(updates[0].sql, /total_hours = 0/);
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

test("the hourly 12-hour reminder is persisted once for an open shift", async () => {
  let warned = false;
  let notices = 0;
  db.getConnection = async () => ({
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql) {
      if (sql.includes("SELECT id, user_id, internship_id")) {
        assert.match(sql, /INTERVAL 12 HOUR/);
        assert.match(sql, /INTERVAL 16 HOUR/);
        assert.match(sql, /wall_warning_sent_at IS NULL/);
        return [warned ? [] : [{ id: 1, user_id: "student", internship_id: "internship" }]];
      }
      if (sql.includes("SET wall_warning_sent_at")) warned = true;
      if (sql.includes("INSERT INTO notifications")) notices++;
      return [{ affectedRows: 1 }];
    },
  });
  await warnLongShifts();
  await warnLongShifts();
  assert.equal(notices, 1);
});

test("an overtime request near scheduled end notifies the assigned employer without closing the shift", async () => {
  const writes = [];
  let existingRequest = false;
  db.getConnection = async () => ({
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, params) {
      if (sql.includes("FROM daily_time_records dtr")) return [[{
        id: 4, internship_id: "internship", employer_id: "employer", student_id: "student",
        company_name: "Company", expected_clock_out: "2026-11-07 17:00:00",
        minutes_to_end: 20, minutes_to_intended_end: 90, minutes_to_safety_close: 400,
      }]];
      writes.push({ sql, params });
      if (sql.includes("UPDATE daily_time_records")) {
        if (existingRequest) return [{ affectedRows: 0 }];
        existingRequest = true;
      }
      return [{ affectedRows: 1 }];
    },
  });
  const req = { verifiedUser: { id: "student", role: "student" }, body: {
    reason: "The ward needs help finishing the evening handover.", intendedEnd: "2026-11-07T18:30",
  } };
  const first = response();
  await requestOvertime(req, first);
  assert.equal(first.statusCode, 200);
  assert.equal(writes.filter(({ sql }) => sql.includes("INSERT INTO notifications")).length, 1);
  assert.equal(writes.some(({ sql }) => sql.includes("clock_out =")), false);
  const second = response();
  await requestOvertime(req, second);
  assert.equal(second.statusCode, 409);
});

test("the student explanation advances an auto-closed entry without crediting hours", async () => {
  const writes = [];
  db.getConnection = async () => ({
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, params) {
      if (sql.includes("FROM daily_time_records dtr")) return [[{
        id: 3, internship_id: "internship", student_id: "student", employer_id: "employer",
        company_name: "Company", auto_close_review_status: "pending_explanation",
      }]];
      if (sql.includes("TIMESTAMPDIFF(SECOND, clock_in")) return [[{ after_start: 8 * 3600, before_system_close: 8 * 3600 }]];
      if (sql.includes("SELECT DISTINCT hd.user_id")) return [[{ user_id: "head" }]];
      writes.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  });
  const res = response();
  await submitAutoCloseExplanation({ verifiedUser: { id: "student", role: "student" },
    params: { dtrId: 3 }, body: { explanation: "I forgot to clock out after the night shift ended.", claimedEnd: "2026-11-07T07:00" } }, res);
  assert.equal(res.statusCode, 200);
  const updated = writes.find(({ sql }) => sql.includes("UPDATE daily_time_records"));
  assert.match(updated.sql, /LEAST\(proposed_hours/);
  assert.deepEqual(updated.params.slice(1, 5), ["2026-11-07 07:00:00", 8 * 3600, 8 * 3600, "pending_review"]);
  assert.equal(writes.some(({ sql }) => sql.includes("UPDATE internship_records")), false);
  assert.deepEqual(writes.filter(({ sql }) => sql.includes("INSERT INTO notifications"))
    .map(({ params }) => params[0]), ["employer", "head"]);
});

test("an explanation for a historical auto-close keeps its existing credit and review state", async () => {
  const writes = [];
  let committed = false;
  db.getConnection = async () => ({
    async beginTransaction() {}, async commit() { committed = true; }, async rollback() {}, release() {},
    async execute(sql, params) {
      if (sql.includes("FROM daily_time_records dtr")) return [[{
        id: 6, internship_id: "internship", student_id: "student", employer_id: null,
        company_name: "Company", auto_close_review_status: "legacy_credited",
      }]];
      if (sql.includes("SELECT DISTINCT hd.user_id")) return [[{ user_id: "head" }]];
      writes.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  });
  const res = response();
  await submitAutoCloseExplanation({ verifiedUser: { id: "student", role: "student" },
    params: { dtrId: 6 }, body: { explanation: "I forgot to clock out after finishing my assigned shift." } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(committed, true);
  assert.match(writes[0].sql, /student_explanation IS NULL/);
  assert.equal(writes[0].params[4], "legacy_credited");
  assert.equal(writes.some(({ sql }) => sql.includes("UPDATE internship_records")), false);
  assert.deepEqual(writes.filter(({ sql }) => sql.includes("INSERT INTO notifications"))
    .map(({ params }) => params[0]), ["head"]);
});

test("auto-closed hours are credited only once by the assigned supervisor", async () => {
  const writes = [];
  let reviewed = false;
  let commits = 0;
  db.getConnection = async () => ({
    async beginTransaction() {}, async rollback() {}, release() {},
    async commit() { commits++; },
    async execute(sql, params) {
      if (sql.includes("SELECT dtr.*")) return [[{
        id: 1, internship_id: "internship", student_id: "student", employer_id: "employer",
        company_name: "Company", auto_closed: 1, auto_close_review_status: reviewed ? "approved" : "pending_review",
        proposed_hours: 8, head_department_code: null,
      }]];
      writes.push({ sql, params });
      if (sql.includes("UPDATE daily_time_records")) reviewed = true;
      return [{ affectedRows: 1 }];
    },
  });
  const req = { verifiedUser: { id: "employer", role: "employer" }, params: { dtrId: 1 }, body: { hours: 7.5 } };
  const first = response();
  await reviewAutoClosedDtr(req, first);
  assert.equal(first.statusCode, 200);
  assert.equal(commits, 1);
  assert.equal(writes.filter(({ sql }) => sql.includes("UPDATE internship_records")).length, 1);
  assert.deepEqual(writes.find(({ sql }) => sql.includes("UPDATE internship_records")).params, [7.5, "internship"]);
  const second = response();
  await reviewAutoClosedDtr(req, second);
  assert.equal(second.statusCode, 409);
  assert.equal(commits, 1);
  assert.equal(writes.filter(({ sql }) => sql.includes("UPDATE internship_records")).length, 1);
});

test("Registrar and unrelated employers cannot review an auto-closed student's hours", async () => {
  let writes = 0;
  db.getConnection = async () => ({
    async beginTransaction() {}, async rollback() {}, release() {},
    async execute(sql) {
      if (sql.includes("SELECT dtr.*")) return [[{
        id: 1, internship_id: "internship", student_id: "student",
        employer_id: "assigned", department_id: 3,
        head_department_id: 3, head_department_code: "REG",
        auto_closed: 1, auto_close_review_status: "pending_review", proposed_hours: 8,
      }]];
      writes++;
      return [{ affectedRows: 1 }];
    },
  });
  for (const actor of [{ id: "registrar", role: "department_head" }, { id: "other", role: "employer" }]) {
    const res = response();
    await reviewAutoClosedDtr({ verifiedUser: actor, params: { dtrId: 1 }, body: { hours: 8 } }, res);
    assert.equal(res.statusCode, 403);
  }
  assert.equal(writes, 0);
});


test("valid Philippine coordinates produce an actionable storage error and roll back on old longitude columns", async () => {
  for (const [action, column] of [[clockIn, "lon_in"], [clockOut, "lon_out"]]) {
    let rolledBack = false, committed = false, released = false;
    db.getConnection = async () => ({
      async beginTransaction() {},
      async rollback() { rolledBack = true; },
      async commit() { committed = true; },
      release() { released = true; },
      async execute(sql, params) {
        if(sql.includes('FROM dtr_weekly_schedules'))return [[{id:1,source:'student',working_days:'[0,1,2,3,4,5,6]',clock_in_time:'08:00',clock_out_time:'18:00',effective_from:'2026-11-01'}]];
        if(sql.includes('COUNT(*) AS total'))return [[{total:0}]];
        if(sql.includes('FROM dtr_absence_reports'))return [[]];
        if (sql.includes("SELECT id FROM users")) return [[{ id: "student" }]];
        if (sql.includes("SELECT id FROM daily_time_records")) return [[]];
        if (sql.includes("DATE(clock_in) = CURDATE()")) return [[]];
        if (sql.includes("FROM internship_records ir") || sql.includes("FROM daily_time_records dtr")) {
          return [[{ internship_id: "internship", dtr_id: 1, date_started: "2026-01-01", has_started: 1,
            company_lat: 14, company_lon: 121, clock_in: "2026-10-29 08:00:00", status: "present", break_started_at: null }]];
        }
        if (sql.includes("TIMESTAMPDIFF")) return [[{ hours: 1 }]];
        if (sql.includes("DATE_FORMAT(NOW()")) return [[{ recorded_at: "2026-11-05 17:00:00" }]];
        if (sql.includes("INSERT INTO daily_time_records") || sql.includes("UPDATE daily_time_records")) {
          assert.ok(params.includes(121), "valid longitude reaches the storage write unchanged");
          throw Object.assign(new Error("coordinate storage range"), {
            code: "ER_WARN_DATA_OUT_OF_RANGE", sqlMessage: "Out of range value for column '" + column + "' at row 1",
          });
        }
        throw new Error("Unexpected SQL");
      },
    });
    const res = response();
    await action({ verifiedUser: { id: "student", role: "student" }, file: photo, query: {}, body: { lat_in: 14, lon_in: 121, lat_out: 14, lon_out: 121 } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "DTR_LOCATION_STORAGE_UNAVAILABLE");
    assert.match(res.body.error, /could not be saved.*contact your coordinator/i);
    assert.doesNotMatch(res.body.error, /rejected|away from|lon_in|lon_out/i);
    assert.equal(rolledBack, true);
    assert.equal(committed, false);
    assert.equal(released, true);
  }
});
