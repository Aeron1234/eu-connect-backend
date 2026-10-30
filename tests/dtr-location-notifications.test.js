import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_KEY = "no-network";

const { db } = await import("../config/db.js");
const { setSearchedStudentDtrLocation } = await import("../features/dtr-locations/individualDtrLocationController.js");

async function setLocation({ role, employerId }) {
  const originalGetConnection = db.getConnection;
  const notificationRows = [];
  const emitted = [];
  let committed = false;
  db.getConnection = async () => ({
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() {},
    release() {},
    async execute(sql, params) {
      if (sql.includes("FROM internship_records ir")) {
        return [[{
          id: "internship-1",
          user_id: "student-1",
          employer_id: employerId,
          student_first_name: "Alex",
          student_last_name: "Santos",
        }]];
      }
      if (sql.startsWith("SELECT id FROM dtr_locations")) return [[]];
      if (sql.startsWith("INSERT INTO dtr_locations")) return [{ affectedRows: 1, insertId: 7 }];
      if (sql.startsWith("SELECT first_name, last_name FROM user_profiles")) {
        return [[{ first_name: "Pat", last_name: "Reyes" }]];
      }
      if (sql.startsWith("INSERT INTO notifications")) {
        notificationRows.push(params);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  });

  const req = {
    params: { searchedUserId: "student-1" },
    query: { internshipId: "internship-1" },
    verifiedUser: { id: role === "employer" ? "employer-1" : "staff-1", role },
    body: { lat: 13.9, lon: 121.6, radius_meter: 150, address: "Main Office" },
    app: { get: () => ({ to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) }) },
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await setSearchedStudentDtrLocation(req, res);
    return { res, notificationRows, emitted, committed };
  } finally {
    db.getConnection = originalGetConnection;
  }
}

for (const role of ["admin", "department_head"]) {
  test(`${role} setting an intern's DTR location notifies the student and accepted supervisor`, async () => {
    const result = await setLocation({ role, employerId: "employer-1" });
    assert.equal(result.res.statusCode, 200);
    assert.equal(result.committed, true);
    assert.deepEqual(result.notificationRows.map((row) => row[0]), ["student-1", "employer-1"]);
    assert.equal(result.notificationRows[1][5], "internship-1");
    assert.match(result.notificationRows[1][4], /Alex Santos's DTR check-in location at Main Office/);
    assert.deepEqual(result.emitted.map(({ room }) => room), ["user-student-1", "user-employer-1"]);
    assert.equal(result.emitted[1].payload.type, "dtr_location_set");
  });
}

test("staff setting a DTR location without a supervisor only notifies the student", async () => {
  const result = await setLocation({ role: "admin", employerId: null });
  assert.deepEqual(result.notificationRows.map((row) => row[0]), ["student-1"]);
  assert.deepEqual(result.emitted.map(({ room }) => room), ["user-student-1"]);
});

test("a supervisor setting their intern's DTR location does not notify themselves", async () => {
  const result = await setLocation({ role: "employer", employerId: "employer-1" });
  assert.deepEqual(result.notificationRows.map((row) => row[0]), ["student-1"]);
  assert.deepEqual(result.emitted.map(({ room }) => room), ["user-student-1"]);
});
