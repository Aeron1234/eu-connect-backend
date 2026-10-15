import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import {
  getSupervisorStatus,
  requestSupervisor,
  respondToSupervisorRequest,
  removeSupervisor,
} from "../features/supervisor-requests/controllers/supervisorRequestController.js";

async function invoke(handler, req, execute) {
  const original = db.getConnection;
  const statements = [];
  const events = [];
  const roomsLeft = [];
  let committed = false;
  let rolledBack = false;
  db.getConnection = async () => ({
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() { rolledBack = true; },
    release() {},
    async execute(sql, params) {
      statements.push({ sql, params });
      return execute(sql, params);
    },
  });
  const io = {
    to: (room) => ({ emit: (event, payload) => events.push({ room, event, payload }) }),
    in: (room) => ({ socketsLeave: (target) => roomsLeft.push({ room, target }) }),
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await handler({ ...req, app: { get: () => io } }, res);
    return { res, statements, events, roomsLeft, committed, rolledBack };
  } finally {
    db.getConnection = original;
  }
}

test("an assigned student sees only the current employer as supervisor", async () => {
  for (const employerId of ["assigned", "other"]) {
    const result = await invoke(getSupervisorStatus, {
      verifiedUser: { id: "student" }, params: { employerId },
    }, (sql) => {
      assert.match(sql, /deleted_at IS NULL/);
      return [[{ id: "internship", employer_id: "assigned" }]];
    });
    assert.equal(result.res.body.status, employerId === "assigned" ? "accepted" : null);
    assert.equal(result.res.body.hasSupervisor, true);
    assert.equal(result.statements.length, 1);
  }
});

test("a student cannot request another employer while already supervised", async () => {
  const result = await invoke(requestSupervisor, {
    verifiedUser: { id: "student" }, body: { employerId: "other" },
  }, () => [[{ id: "internship", employer_id: "assigned", company_name: "Company" }]]);
  assert.equal(result.res.statusCode, 409);
  assert.equal(result.committed, false);
  assert.equal(result.rolledBack, true);
  assert.equal(result.statements.some(({ sql }) => sql.startsWith("INSERT") || sql.startsWith("UPDATE")), false);
});

test("an old pending request cannot replace an accepted supervisor", async () => {
  const result = await invoke(respondToSupervisorRequest, {
    verifiedUser: { id: "other" }, params: { requestId: "request" }, body: { decision: "accept" },
  }, (sql) => sql.includes("FROM supervisor_requests")
    ? [[{ id: "request", internship_id: "internship", student_id: "student", employer_id: "other", status: "pending" }]]
    : [[{ id: "internship", status: "ongoing", employer_id: "assigned", company_name: "Company" }]]);
  assert.equal(result.res.statusCode, 409);
  assert.equal(result.rolledBack, true);
  assert.equal(result.statements.some(({ sql }) => sql.startsWith("UPDATE")), false);
});

test("only the student can remove their current employer from the ongoing internship", async () => {
  const result = await invoke(removeSupervisor, {
    verifiedUser: { id: "student" }, params: { employerId: "assigned" },
  }, (sql) => {
    if (sql.startsWith("SELECT")) return [[{ id: "internship", employer_id: "assigned", company_name: "Company" }]];
    return [{ affectedRows: 1 }];
  });
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.committed, true);
  assert.deepEqual(result.statements.find(({ sql }) => sql.startsWith("UPDATE")).params,
    ["internship", "student", "assigned"]);
  assert.match(result.statements.find(({ sql }) => sql.startsWith("UPDATE")).sql, /employer_id = NULL/);
  assert.equal(result.statements.some(({ sql }) => sql.includes("UPDATE supervisor_requests SET status = 'superseded'")), true);
  assert.deepEqual(result.roomsLeft, [{ room: "user-assigned", target: "dtr-location:student:internship" }]);
  assert.deepEqual(result.events.map(({ room }) => room), ["user-student", "user-assigned"]);
});

test("removing a different employer cannot unset the current supervisor", async () => {
  const result = await invoke(removeSupervisor, {
    verifiedUser: { id: "student" }, params: { employerId: "other" },
  }, () => [[{ id: "internship", employer_id: "assigned", company_name: "Company" }]]);
  assert.equal(result.res.statusCode, 404);
  assert.equal(result.rolledBack, true);
  assert.equal(result.statements.some(({ sql }) => sql.startsWith("UPDATE")), false);
});
