import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_KEY = "no-network";
const { db } = await import("../config/db.js");
const { updateDepartment, updateCourse } = await import("../features/departments-and-courses/controllers/departmentsAndCoursesControllers.js");
const { removeSearchedStudentDtrLocation } = await import("../features/dtr-locations/individualDtrLocationController.js");

async function invoke(handler, req, execute) {
  const original = db.getConnection;
  const sql = [];
  const state = { committed: false, rolledBack: false, released: false };
  db.getConnection = async () => ({
    async beginTransaction() {},
    async commit() { state.committed = true; },
    async rollback() { state.rolledBack = true; },
    release() { state.released = true; },
    async execute(query, params) { sql.push({ query, params }); return execute(query); },
  });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  try { await handler(req, res); return { res, sql, ...state }; }
  finally { db.getConnection = original; }
}

test("department edits reject duplicate codes before writing", async () => {
  const result = await invoke(updateDepartment, { params: { id: "3" }, body: { name: "Science", code: "SCI" } },
    (query) => query.includes("FOR UPDATE") ? [[{ id: 3 }]] : [[{ id: 4 }]]);
  assert.equal(result.res.statusCode, 409);
  assert.equal(result.rolledBack, true);
  assert.equal(result.committed, false);
  assert.equal(result.sql.some(({ query }) => query.startsWith("UPDATE")), false);
});

test("course edits save name, code, and department", async () => {
  const result = await invoke(updateCourse, { params: { id: "8" }, body: { course_name: "Computer Science", short_name: "BSCS", department_id: "2" } },
    (query) => {
      if (query.includes("FOR UPDATE")) return [[{ id: 8 }]];
      if (query.includes("FROM departments")) return [[{ id: 2 }]];
      if (query.includes("WHERE short_name")) return [[]];
      if (query.startsWith("UPDATE")) return [{ affectedRows: 1 }];
      return [[{ id: 8, course_name: "Computer Science", short_name: "BSCS", department_id: 2 }]];
    });
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.res.body.course.short_name, "BSCS");
  assert.deepEqual(result.sql.find(({ query }) => query.startsWith("UPDATE")).params, ["Computer Science", "BSCS", 2, 8]);
  assert.equal(result.committed, true);
});

test("an unrelated employer cannot remove the custom DTR location", async () => {
  const result = await invoke(removeSearchedStudentDtrLocation,
    { params: { searchedUserId: "student" }, query: { internshipId: "internship" }, verifiedUser: { id: "other", role: "employer" } },
    () => [[{ id: "internship", employer_id: "assigned", lat: 13, lon: 121 }]]);
  assert.equal(result.res.statusCode, 403);
  assert.equal(result.sql.some(({ query }) => query.startsWith("DELETE")), false);
  assert.equal(result.rolledBack, true);
});

test("authorized removal restores the company location", async () => {
  const result = await invoke(removeSearchedStudentDtrLocation,
    { params: { searchedUserId: "student" }, query: { internshipId: "internship" }, verifiedUser: { id: "assigned", role: "employer" } },
    (query) => query.startsWith("DELETE") ? [{ affectedRows: 1 }] : [[{ id: "internship", employer_id: "assigned", lat: 13, lon: 121 }]]);
  assert.equal(result.res.statusCode, 200);
  assert.deepEqual([result.res.body.dtrLocation.lat, result.res.body.dtrLocation.lon], [13, 121]);
  assert.equal(result.sql.some(({ query }) => query.startsWith("DELETE FROM dtr_locations")), true);
  assert.equal(result.committed, true);
  assert.equal(result.released, true);
});
