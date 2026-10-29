import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_KEY = "no-network";
const { db } = await import("../config/db.js");
const { getInternshipRecordOverview } = await import("../features/internship-records/controllers/internshipRecordControllers.js");
const original = db.getConnection;
after(async () => { db.getConnection = original; await db.end(); });

test("overview keeps its response while loading three indexed counts with details", async () => {
  const calls = [];
  let releases = 0;
  let website = "https://company.example.test/";
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT ir.id, ir.deleted_at"))
        return [[{ id: "internship", deleted_at: null, department_id: 1 }]];
      return [[{
        student_id: "student", first_name: "Pat", last_name: "Lee",
        student_number: "123", course_name: "BSIT", company_name: "Company",
        company_address: "Lucena City", lat: "13.9411", lon: "121.6234",
        company_website: website,
        internship_position: "Intern", status: "ongoing", created_at: "2026-09-01",
        date_started: "2026-09-01", date_ended: null,
        supervisor_first_name: "Sam", supervisor_last_name: "Reyes",
        total_hours: 100, accumulated_hours: 20,
        dtr_count: 8, narrative_count: 3, document_count: 2,
      }]];
    },
  });
  const res = {
    statusCode: 200, locals: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await getInternshipRecordOverview({
    method: "POST", verifiedUser: { id: "admin", role: "admin" },
    params: { internshipId: "internship" },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.params), [["internship"], ["internship"]]);
  for (const table of ["daily_time_records", "weekly_narratives", "internship_documents"])
    assert.match(calls[1].sql, new RegExp(`SELECT COUNT\\(\\*\\) FROM ${table} WHERE internship_id = ir\\.id`));
  assert.match(calls[1].sql, /MAX\(sai_latest\.id\)/);
  assert.match(calls[1].sql, /ir\.company_address, ir\.lat, ir\.lon/);
  assert.match(calls[1].sql, /ir\.company_website/);
  assert.doesNotMatch(calls[1].sql, /GROUP BY user_id/);
  assert.deepEqual(res.body, {
    created_at: "2026-09-01", student_id: "student", student_name: "Pat Lee",
    student_number: "123", course_name: "BSIT", company_name: "Company",
    company_address: "Lucena City", lat: "13.9411", lon: "121.6234",
    company_website: website,
    internship_position: "Intern", status: "ongoing", supervisor_name: "Sam Reyes",
    date_started: "2026-09-01", date_ended: null, submitted_at: "2026-09-01",
    total_hours: 100, accumulated_hours: 20, percent_complete: 20,
    dtr_count: 8, narrative_count: 3, document_count: 2,
  });
  assert.equal(releases, 1);
  website = null;
  await getInternshipRecordOverview({ method: "POST", verifiedUser: { id: "admin", role: "admin" }, params: { internshipId: "internship" } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.company_website, null); assert.equal(releases, 2);
});
