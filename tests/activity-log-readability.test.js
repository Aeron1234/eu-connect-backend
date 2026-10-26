import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { updateAlumniInternshipRecord } from "../features/past-internships/controllers/alumniRecordControllers.js";
import { activityLogRoleName, activityLogDocumentPhase } from "../config/activityLogMessages.js";
import { formatActivityLogUserName } from "../config/activityLogNames.js";

test("alumni update logs identify the person/company in plain language while preserving audit IDs and fields", async t => {
  const original = db.getConnection;
  let log, committed = false, released = false;
  db.getConnection = async () => ({
    async beginTransaction() {}, async rollback() {}, release() { released = true; }, async commit() { committed = true; },
    async execute(sql, params) {
      if (sql.includes("INSERT INTO activity_logs")) { log = params; return [{ affectedRows: 1 }]; }
      if (sql.includes("FROM dept_heads_background_info")) return [[{ department_id: 7 }]];
      if (sql.includes("FOR UPDATE")) return [[{ id: "private-record-id", department_id: 7 }]];
      if (sql.startsWith("SELECT * FROM alumni")) return [[{ id: "private-record-id", alumni_name: "Ana Cruz", company_name: "Acme", course_id: 4, accumulated_hours: 120 }]];
      return [{ affectedRows: 1 }];
    },
  });
  t.after(() => { db.getConnection = original; });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await updateAlumniInternshipRecord({ verifiedUser: { id: "head-id", role: "department_head" }, params: { recordId: "private-record-id" }, body: { course_id: 4, accumulated_hours: 120 } }, res);
  assert.equal(res.statusCode, 200); assert(committed); assert(released);
  assert.equal(log[0], "head-id"); assert.equal(log[2], "alumni_internship_record_updated"); assert.equal(log[4], "private-record-id");
  assert.match(log[5], /Department head updated.*Ana Cruz at Acme/);
  assert.doesNotMatch(log[5], /department_head|course_id|accumulated_hours|private-record-id/);
  const metadata = JSON.parse(log[6]);
  assert.deepEqual(metadata.changed_fields, ["course_id", "accumulated_hours"]);
  assert.equal(metadata.alumni_name, "Ana Cruz"); assert.equal(metadata.company_name, "Acme");
});

test("shared message labels never expose internal role codes or incomplete person names", () => {
  assert.equal(activityLogRoleName("department_head"), "Department head");
  assert.equal(activityLogRoleName("admin"), "Admin");
  assert.equal(activityLogRoleName("constructor"), "User");
  assert.equal(activityLogDocumentPhase("before"), "before deployment");
  assert.equal(activityLogDocumentPhase("after"), "after deployment");
  assert.equal(formatActivityLogUserName({ first_name: " Ana ", last_name: null }), "Ana");
  assert.equal(formatActivityLogUserName({ first_name: null, last_name: " Cruz " }), "Cruz");
  assert.equal(formatActivityLogUserName({}, "Unknown user"), "Unknown user");
});
