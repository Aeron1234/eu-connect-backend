import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import express from "express";
import { db } from "../config/db.js";
import cache from "../config/cache/cache.js";
import { readRotation, rotationEnabled, narrativeRotationSnapshot } from "../features/internship-rotations/rotationPolicy.js";
import { getRotations, mutateRotation } from "../features/internship-rotations/rotationController.js";
import { createWeeklyNarrative, editWeeklyNarrative } from "../features/weekly-narratives/controllers/weeklyNarrativeControllers.js";

const original = db.getConnection;
const originalExecute = db.execute;
db.execute = async () => [{ affectedRows: 1 }]; // Error telemetry is mocked too; never contact the configured database.
after(async () => { db.getConnection = original; db.execute = originalExecute; cache.close(); await db.end(); });
beforeEach(() => cache.flushAll());
const record = { id: "record", user_id: "student", employer_id: "employer", company_name: "Hotel", status: "ongoing", deleted_at: null, rotations_enabled: 1, date_started: "2000-01-01", date_ended: "2099-12-31" };
const row = { id: "rotation-1", department_name: "Housekeeping", supervisor_name: "Supervisor", date_from: "2026-11-01", date_to: "2026-11-07" };
const req = (role = "student", id = role) => ({ verifiedUser: { role, id }, params: { internshipId: "record" }, body: {}, method: "POST" });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, set() {}, json(body) { this.body = body; return this; } });

function mock({ current = record, overlap = false, headAllowed = true, failure = false } = {}) {
  const calls = [], events = [];
  db.getConnection = async () => ({
    async beginTransaction() { events.push("begin"); }, async commit() { events.push("commit"); }, async rollback() { events.push("rollback"); }, release() { events.push("release"); },
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM internship_records")) return [[current].filter(Boolean)];
      if (sql.includes("FROM student_academic_info")) return [[{ student_department_id: 1, head_department_id: headAllowed ? 1 : 2 }]];
      if (sql.includes("SELECT rotation_assignments")) return [[{ rotation_assignments: JSON.stringify([row]) }]];
      if (sql.includes("FROM internship_rotations")) {
        if (sql.includes("date_from <=")) return [overlap ? [{ id: "other" }] : []];
        return [[row]];
      }
      if (failure && sql.includes("INSERT INTO internship_rotations")) throw new Error("mock write failure");
      return [{ affectedRows: 1 }];
    },
  });
  return { calls, events };
}

test("rotations are opt-in across departments and reject ambiguous settings", () => {
  for (const value of [true, 1, "1", "on", "true"]) assert.equal(rotationEnabled(value), true);
  for (const value of [false, 0, "0", undefined, null, "off"]) assert.equal(rotationEnabled(value), false);
  for (const value of ["yes", [], {}, 2]) assert.throws(() => rotationEnabled(value), { status: 400 });
});

test("rotation validation accepts same-day assignments but rejects impossible dates and pre-start ranges", () => {
  assert.equal(readRotation({ ...row, department_name: "  Housekeeping  " }, record).department_name, "Housekeeping");
  assert.equal(readRotation({ ...row, date_to: row.date_from }, record).date_to, row.date_from);
  for (const change of [{ department_name: " " }, { date_from: "2026-02-30" }, { date_to: "2026-10-30" }, { date_from: "1999-12-31" }, { supervisor_name: "x".repeat(121) }, { notes: "x".repeat(1001) }]) {
    assert.throws(() => readRotation({ ...row, ...change }, record), { status: 400 });
  }
});

test("rotation dates are independent of the estimated internship end date", () => {
  for (const date_ended of ["2026-10-31", null, "", "invalid-estimate"]) {
    assert.equal(readRotation(row, { ...record, date_ended }).date_to, row.date_to);
  }
  assert.equal(readRotation({ ...row, date_to: "2100-01-01" }, record).date_to, "2100-01-01");
  assert.throws(() => readRotation(row, { ...record, date_started: null }), { status: 400 });
});

test("ongoing owners can create and edit rotations beyond an estimated end while preserving lifecycle and overlap checks", async () => {
  for (const editing of [false, true]) {
    const state = mock({ current: { ...record, date_ended: "2026-10-31" } });
    const request = req(), res = response(); request.body = row;
    if (editing) { request.method = "PATCH"; request.params.rotationId = row.id; }
    await mutateRotation(request, res);
    assert.equal(res.code, 200); assert.equal(res.body.success, true); assert(state.events.includes("commit"));
    assert(state.calls.some(call => call.sql.includes(editing ? "UPDATE internship_rotations" : "INSERT INTO internship_rotations")));
    assert(state.calls.some(call => call.sql.includes("date_from <= ? AND date_to >= ?")));
  }
});

test("reads authorize owner, assigned employer and current department head, excluding admin", async () => {
  for (const [role, id, allowed, headAllowed] of [["student", "student", true], ["student", "other", false], ["employer", "employer", true], ["employer", "other", false], ["department_head", "head", true, true], ["department_head", "head", false, false], ["admin", "admin", false]]) {
    const state = mock({ headAllowed }); const res = response();
    await getRotations(req(role, id), res);
    assert.equal(res.code, allowed ? 200 : 403, `${role}/${id}`);
    assert.equal(res.body.rotations?.length, allowed ? 1 : undefined);
    assert(state.events.includes("release"));
  }
  mock({ current: { ...record, deleted_at: "2026-01-01" } }); const res = response(); await getRotations(req(), res); assert.equal(res.code, 404);
});

test("overlap checks occur after the parent lock and rollback on conflict", async () => {
  const state = mock({ overlap: true }), res = response(), request = req(); request.body = row;
  await mutateRotation(request, res);
  assert.equal(res.code, 409); assert.match(state.calls[0].sql, /FOR UPDATE/);
  assert(!state.calls.some(call => call.sql.includes("INSERT INTO internship_rotations")));
  assert.deepEqual(state.events, ["begin", "rollback", "release"]);
});

test("students save rotations transactionally and failures do not commit", async () => {
  const state = mock(), request = req(), res = response(); request.body = row;
  await mutateRotation(request, res); assert.equal(res.body.success, true);
  assert(state.calls.some(call => call.sql.includes("INSERT INTO internship_rotations")));
  assert(state.calls.some(call => call.sql.includes("INSERT INTO activity_logs") && call.values[5].includes("Housekeeping")));
  assert.deepEqual(state.events, ["begin", "commit", "release"]);
  const failed = mock({ failure: true }), failure = response(); await mutateRotation(request, failure);
  assert.equal(failure.code, 500); assert(failed.events.includes("rollback")); assert(!failed.events.includes("commit"));
});

test("staff and other students cannot mutate, finished records are read-only, pending records can opt in", async () => {
  for (const [role, id, current, expected] of [["admin", "admin", record, 403], ["employer", "employer", record, 403], ["student", "other", record, 403], ["student", "student", { ...record, status: "finished" }, 409]]) {
    const state = mock({ current }), res = response(), request = req(role, id); request.body = row;
    await mutateRotation(request, res); assert.equal(res.code, expected); assert(!state.events.includes("commit"));
  }
  const state = mock({ current: { ...record, status: "pending" } }), request = req(), res = response(); request.rotationOperation = "settings"; request.body = { enabled: true };
  await mutateRotation(request, res); assert.equal(res.code, 200); assert(state.events.includes("commit"));
});

test("disabling retains assignments; deletion soft-deletes only the requested record's assignment", async () => {
  const state = mock(), request = req(), res = response(); request.rotationOperation = "settings"; request.body.enabled = false;
  await mutateRotation(request, res); assert(res.body.success);
  assert(!state.calls.some(call => /DELETE|UPDATE internship_rotations/.test(call.sql)));
  const removed = mock(), deletion = req(), deleted = response(); deletion.method = "DELETE"; deletion.params.rotationId = row.id;
  await mutateRotation(deletion, deleted); assert(deleted.body.success);
  const write = removed.calls.find(call => call.sql.includes("SET deleted_at = NOW()")); assert.deepEqual(write.values, [row.id, record.id]);
});

test("narrative snapshots reject foreign, duplicate, disabled and non-overlapping selections", async () => {
  const connection = { execute: async () => [[row]] }, dates = { from: "2026-11-01", to: "2026-11-14" };
  assert.equal(await narrativeRotationSnapshot(connection, record, {}, dates), undefined);
  assert.equal(await narrativeRotationSnapshot(connection, record, { rotation_ids: "[]" }, dates), null);
  for (const ids of ['["other"]', '["rotation-1","rotation-1"]', "not json"]) {
    await assert.rejects(narrativeRotationSnapshot(connection, record, { rotation_ids: ids }, dates), { status: 400 });
  }
  await assert.rejects(narrativeRotationSnapshot(connection, { ...record, rotations_enabled: 0 }, { rotation_ids: '["rotation-1"]' }, dates), { status: 400 });
  await assert.rejects(narrativeRotationSnapshot(connection, record, { rotation_ids: '["rotation-1"]' }, { from: "2026-12-01", to: "2026-12-07" }), { status: 400 });
  assert.deepEqual(JSON.parse(await narrativeRotationSnapshot(connection, record, { rotation_ids: '["rotation-1"]' }, dates)), [row]);
  const changed = { execute: async () => [[{ ...row, department_name: "Renamed unit", date_from: "2026-12-01", date_to: "2026-12-07" }]] };
  assert.deepEqual(JSON.parse(await narrativeRotationSnapshot(changed, record, { rotation_ids: '["rotation-1"]' }, dates, JSON.stringify([row]), true)), [row]);
  assert.deepEqual(JSON.parse(await narrativeRotationSnapshot({ execute: async () => [[]] }, record, { rotation_ids: '["rotation-1"]' }, dates, JSON.stringify([row]))), [row]);
});

test("narrative create/edit beyond the estimated end persist validated snapshots inside the existing parent transaction", async () => {
  for (const action of [createWeeklyNarrative, editWeeklyNarrative]) {
    const state = mock({ current: { ...record, date_ended: "2026-10-31" } }), request = req(), res = response();
    request.query = { internshipId: record.id }; request.params.narrativeId = 1;
    request.body = { title: "Week", narrative: "Worked in two units", week_number: 1, date_from: row.date_from, date_to: row.date_to, rotation_ids: '["rotation-1"]' };
    await action(request, res); assert(res.body.success, JSON.stringify(res.body));
    const write = state.calls.find(call => /INSERT INTO weekly_narratives|UPDATE weekly_narratives/.test(call.sql));
    assert.match(write.sql, /rotation_assignments/); assert(write.values.some(value => value === JSON.stringify([row])));
    if (action === editWeeklyNarrative) {
      assert.equal(res.body.narrative.id, 1);
      assert.deepEqual(JSON.parse(res.body.narrative.rotation_assignments), [row]);
    }
    assert(state.events.includes("commit")); assert.match(state.calls[0].sql, /FOR UPDATE/);
  }
});

test("finished records keep rotations beyond the estimate readable while assignment writes stay locked", async () => {
  const current = { ...record, status: "finished", date_ended: "2026-10-31" };
  mock({ current }); const read = response(); await getRotations(req(), read);
  assert.equal(read.code, 200); assert.equal(read.body.canManage, false); assert.deepEqual(read.body.rotations, [row]);
  const state = mock({ current }), write = response(), request = req(); request.body = row;
  await mutateRotation(request, write); assert.equal(write.code, 409); assert(!state.events.includes("commit"));
});

test("migration defaults existing internships to opt-out and leaves historical narratives blank", () => {
  const sql = readFileSync(new URL("../scripts/2026-10-27-internship-rotations.sql", import.meta.url), "utf8");
  assert.match(sql, /rotations_enabled TINYINT\(1\) NOT NULL DEFAULT 0/);
  assert.match(sql, /rotation_assignments JSON NULL DEFAULT NULL/);
  assert.match(sql, /FOREIGN KEY \(internship_id\) REFERENCES internship_records/);
  assert.doesNotMatch(sql, /UPDATE weekly_narratives|DROP COLUMN|DELETE FROM/);
});

test("authenticated rotation routes enforce login and role guards before controller writes", async (t) => {
  process.env.ACCESS_TOKEN_SECRET = "rotation-test-access";
  process.env.REFRESH_TOKEN_SECRET = "rotation-test-refresh";
  process.env.TEMP_PASSWORD_SECRET = "rotation-test-temporary";
  const { default: router } = await import("../features/internship-rotations/rotationRoutes.js");
  const { signAccessToken } = await import("../config/jwt.js");
  const app = express(); app.use(express.json()); app.use("/api/v1", router);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/api/v1/internship-records/record/rotations`;
  const token = role => signAccessToken({ id: role, role });
  let result = await fetch(url); assert.equal(result.status, 401); await result.text();
  const state = mock();
  result = await fetch(url + "/settings", { method: "PATCH", headers: { Authorization: `Bearer ${token("admin")}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
  assert.equal(result.status, 403); await result.text(); assert.equal(state.calls.length, 0);
  result = await fetch(url, { headers: { Authorization: `Bearer ${token("student")}` } });
  assert.equal(result.status, 200); assert.equal((await result.json()).rotations.length, 1); assert.equal(result.headers.get("cache-control"), "private, no-store");
  result = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token("student")}`, "Content-Type": "application/json" }, body: JSON.stringify(row) });
  assert.equal(result.status, 200); assert.equal((await result.json()).success, true);
});
