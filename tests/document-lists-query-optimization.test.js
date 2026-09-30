import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_KEY = "no-network";
const { db } = await import("../config/db.js");
const { getInternshipFiles } = await import("../controllers/fileControllers.js");
const { getSearchedStudentFiles, getEmployerUploadedFiles } = await import("../controllers/searchedUserController.js");
const { getInternshipRecordDocuments } = await import("../controllers/internshipRecordControllers.js");
const originalExecute = db.execute;
const originalConnection = db.getConnection;
after(async () => { db.execute = originalExecute; db.getConnection = originalConnection; await db.end(); });

function response() {
  return {
    statusCode: 200, locals: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("searched student files group ordered documents once and retain completion counts", async () => {
  const internships = [
    { id: "ongoing", status: "ongoing", company_name: "A", totalRequirements: 3 },
    { id: "past", status: "completed", company_name: "B", totalRequirements: 3 },
  ];
  const documents = [
    { id: "past-file", internship_id: "past", requirement_type_id: 2 },
    { id: "new", internship_id: "ongoing", requirement_type_id: 1 },
    { id: "older", internship_id: "ongoing", requirement_type_id: 1 },
    { id: "orphan", internship_id: "other", requirement_type_id: 3 },
  ];
  const calls = [];
  let releases = 0;
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(sql, params) {
      calls.push({ sql, params });
      return [sql.includes("FROM internship_records ir") ? internships : documents];
    },
  });
  const req = { params: { searchedUserId: "student" } };
  const res = response();
  await getSearchedStudentFiles(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.params), [["student"], ["student"]]);
  assert.match(calls[0].sql, /SELECT COUNT\(\*\) FROM requirement_types/);
  assert.match(calls[1].sql, /verification_status IS NULL OR doc\.verification_status = 'accepted'/);
  assert.deepEqual(res.body.map((record) => ({
    id: record.id, submittedCount: record.submittedCount,
    completionPercent: record.completionPercent,
    fileIds: record.files.map((file) => file.id),
  })), [
    { id: "ongoing", submittedCount: 1, completionPercent: 33, fileIds: ["new", "older"] },
    { id: "past", submittedCount: 1, completionPercent: 33, fileIds: ["past-file"] },
  ]);
  assert.equal(res.body[0].totalRequirements, 3);
  assert.equal(releases, 1);

  calls.length = 0;
  internships.length = 0;
  const empty = response();
  await getSearchedStudentFiles(req, empty);
  assert.deepEqual(empty.body, []);
  assert.equal(calls.length, 1);
});

test("other document lists keep indexed ownership filters and their row shapes", async () => {
  const row = { id: "document", internship_id: "internship", file_name: "file.pdf",
    requirement_name: "Requirement", verification_status: "accepted" };
  const calls = [];
  db.execute = async (sql, params) => { calls.push({ sql, params }); return [[row]]; };

  const own = response();
  await getInternshipFiles({ verifiedUser: { id: "student" },
    query: { internshipId: "internship", category: "pre" } }, own);
  assert.deepEqual(own.body, [row]);
  assert.deepEqual(calls[0].params, ["student", "internship", "pre"]);
  assert.match(calls[0].sql, /ORDER BY doc\.created_at DESC/);

  const uploaded = response();
  await getEmployerUploadedFiles({ verifiedUser: { id: "employer" },
    params: { searchedUserId: "student" } }, uploaded);
  assert.deepEqual(uploaded.body, [row]);
  assert.deepEqual(calls[1].params, ["student", "employer"]);
  assert.match(calls[1].sql, /doc\.uploaded_by_role = 'employer'/);
  assert.equal(calls.length, 2);

  db.getConnection = async () => ({
    release() {},
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT ir.id, ir.deleted_at"))
        return [[{ id: "internship", deleted_at: null, department_id: 1 }]];
      return [[row]];
    },
  });
  const record = response();
  await getInternshipRecordDocuments({ method: "POST",
    verifiedUser: { id: "admin", role: "admin" },
    params: { internshipId: "internship" } }, record);
  assert.deepEqual(record.body, [row]);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[3].params, ["internship"]);
  assert.match(calls[3].sql, /ORDER BY d\.created_at DESC/);
});
