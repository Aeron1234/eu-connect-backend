import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { getWeeklyNarrativesForPrint } from "../features/weekly-narratives/controllers/weeklyNarrativeControllers.js";

const originalExecute = db.execute;
after(async () => {
  db.execute = originalExecute;
  await db.end();
});

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("print read returns every narrative in one request scoped to its owner", async () => {
  const calls = [];
  db.execute = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("FROM internship_records")) return [[{ id: "record-1", company_name: "Company", student_name: "Student" }]];
    return [[
      { week_number: 1, title: "First", narrative: "First week" },
      { week_number: 2, title: "Second", narrative: "Second week" },
    ]];
  };
  const res = response();
  await getWeeklyNarrativesForPrint({ verifiedUser: { id: "student-1" }, params: { internshipId: "record-1" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.narratives.length, 2);
  assert.deepEqual(calls.map(({ params }) => params), [["record-1", "student-1"], ["record-1", "student-1"]]);
  assert.match(calls[1].sql, /ORDER BY week_number ASC/);
  assert.doesNotMatch(calls[1].sql, /LIMIT/);
});

test("print read rejects a record owned by another student", async () => {
  let calls = 0;
  db.execute = async () => { calls += 1; return [[]]; };
  const res = response();
  await getWeeklyNarrativesForPrint({ verifiedUser: { id: "student-1" }, params: { internshipId: "other-record" } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(calls, 1);
});
