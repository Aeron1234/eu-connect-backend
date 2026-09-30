import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { getProgramAnnualReports, getProgramAnnualReportById } from "../controllers/hteReportControllers.js";

const original = db.getConnection;
after(async () => { db.getConnection = original; await db.end(); });

function response() {
  return {
    statusCode: 200, locals: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function invoke(handler, req, answer) {
  const calls = [];
  let releases = 0;
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(sql, params) { calls.push({ sql, params }); return [answer(sql, params)]; },
  });
  const res = response();
  await handler({ method: "POST", verifiedUser: { id: "admin", role: "admin" },
    query: {}, params: {}, ...req }, res);
  return { res, calls, releases };
}

test("populated annual pages carry totals without exposing the internal count", async () => {
  const page = [
    { id: "r1", academic_year: "2026-2027", degree_program: "Computing", status: "draft", total_reports: 4 },
    { id: "r2", academic_year: "2026-2027", degree_program: "Nursing", status: "submitted", total_reports: 4 },
  ];
  const entries = [
    { report_id: "r2", issue: "B", solution: "S2", recommendation: "R2" },
    { report_id: "r1", issue: "A", solution: "S1", recommendation: "R1" },
  ];
  const { res, calls, releases } = await invoke(getProgramAnnualReports,
    { query: { academicYear: "2026-2027", search: "i", page: "2", limit: "2" } },
    (sql) => sql.includes("FROM program_annual_report_entries") ? entries : page);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, ["2026-2027", "%i%", "2026-2027", "%i%", 2, 2]);
  assert.match(calls[0].sql, /AS total_reports/);
  assert.match(calls[0].sql, /ORDER BY degree_program ASC/);
  assert.deepEqual(calls[1].params, ["r1", "r2"]);
  assert.deepEqual(res.body, {
    academicYear: "2026-2027",
    reports: [
      { id: "r1", academic_year: "2026-2027", degree_program: "Computing", status: "draft",
        entries: [{ issue: "A", solution: "S1", recommendation: "R1" }] },
      { id: "r2", academic_year: "2026-2027", degree_program: "Nursing", status: "submitted",
        entries: [{ issue: "B", solution: "S2", recommendation: "R2" }] },
    ],
    pagination: { page: 2, limit: 2, total: 4, totalPages: 2 },
  });
  assert.equal(releases, 1);
});

test("empty and out-of-range pages retain a count without querying empty IDs", async () => {
  for (const [total, totalPages] of [[0, 0], [4, 2]]) {
    const { res, calls } = await invoke(getProgramAnnualReports,
      { query: { academicYear: "2026-2027", page: "9", limit: "2" } },
      (sql) => sql.includes("SELECT COUNT(*) AS total") ? [{ total }] : []);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      academicYear: "2026-2027", reports: [],
      pagination: { page: 9, limit: 2, total, totalPages },
    });
    assert.equal(calls.length, 2);
    assert.doesNotMatch(calls.map((call) => call.sql).join(" "), /IN \(\)/);
  }
});

test("annual details retain the parent and ordered entries lookup", async () => {
  const report = { id: "r1", academic_year: "2026-2027", degree_program: "Computing" };
  const entries = [{ issue: "A", solution: "S", recommendation: "R" }];
  const { res, calls } = await invoke(getProgramAnnualReportById,
    { params: { reportId: "r1" } },
    (sql) => sql.includes("program_annual_report_entries") ? entries : [report]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ...report, entries });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.params), [["r1"], ["r1"]]);
  assert.match(calls[1].sql, /ORDER BY sort_order ASC/);
});
