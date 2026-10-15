import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { getProgramAnnualReports, getProgramAnnualReportById, saveProgramAnnualReport } from "../features/sipp-reports/controllers/hteReportControllers.js";

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
    (sql) => sql.includes("SELECT DISTINCT academic_year")
      ? [{ academic_year: "2026-2027" }]
      : sql.includes("FROM program_annual_report_entries") ? entries : page);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].params, ["2026-2027", "%i%", "2026-2027", "%i%", 2, 2]);
  assert.match(calls[1].sql, /AS total_reports/);
  assert.match(calls[1].sql, /ORDER BY academic_year DESC, degree_program ASC/);
  assert.deepEqual(calls[2].params, ["r1", "r2"]);
  assert.deepEqual(res.body, {
    academicYear: "2026-2027",
    status: "",
    availableYears: ["2026-2027"],
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
      academicYear: "2026-2027", status: "", availableYears: [], reports: [],
      pagination: { page: 9, limit: 2, total, totalPages },
    });
    assert.equal(calls.length, 3);
    assert.doesNotMatch(calls.map((call) => call.sql).join(" "), /IN \(\)/);
  }
});

test("status filters keep submitted entry rows and offer only saved report years", async () => {
  const entry = { report_id: "r1", issue: "Concern", solution: "Resolved", recommendation: "Follow up" };
  const { res, calls } = await invoke(getProgramAnnualReports,
    { query: { academicYear: "2025-2026", status: "submitted" } },
    (sql) => sql.includes("SELECT DISTINCT academic_year")
      ? [{ academic_year: "2025-2026" }]
      : sql.includes("FROM program_annual_report_entries") ? [entry]
        : [{ id: "r1", academic_year: "2025-2026", degree_program: "Nursing", status: "submitted", total_reports: 1 }]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls[1].params, ["2025-2026", "submitted", "2025-2026", "submitted", 10, 0]);
  assert.deepEqual(res.body.availableYears, ["2025-2026"]);
  assert.deepEqual(res.body.reports[0].entries, [{ issue: "Concern", solution: "Resolved", recommendation: "Follow up" }]);
});

test("unfiltered Annex C lists saved reports across academic years", async () => {
  const { res, calls } = await invoke(getProgramAnnualReports, {}, (sql) =>
    sql.includes("SELECT DISTINCT academic_year")
      ? [{ academic_year: "2025-2026" }, { academic_year: "2024-2025" }]
      : sql.includes("FROM program_annual_report_entries") ? []
        : [{ id: "r1", academic_year: "2024-2025", degree_program: "Nursing", total_reports: 1 }]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls[1].params, [10, 0]);
  assert.deepEqual(res.body.availableYears, ["2025-2026", "2024-2025"]);
  assert.equal(res.body.reports[0].academic_year, "2024-2025");
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

test("Annex C exports the creator's initial only when the prepared-by name matches", async () => {
  const { res, calls } = await invoke(getProgramAnnualReportById,
    { params: { reportId: "r1" } },
    (sql) => sql.includes("program_annual_report_entries") ? [] : [{
      id: "r1", prepared_by: "Jane Cruz, Registrar", certified_by: "Maria Santos",
      creator_first_name: "Jane", creator_middle_initial: "a", creator_last_name: "Cruz",
    }]);
  assert.equal(res.body.prepared_by, "Jane Cruz, Registrar");
  assert.equal(res.body.prepared_by_export, "Jane A. Cruz, Registrar");
  assert.equal(res.body.certified_by, "Maria Santos");
  assert.match(calls[0].sql, /LEFT JOIN user_profiles/);
});

test("draft year and program edits target their report ID without overwriting another report", async () => {
  let state = "draft";
  let updated = false;
  let duplicateFound = false;
  let duplicateCheckParams;
  let updateParams;
  db.getConnection = async () => ({
    release() {}, async beginTransaction() {}, async rollback() {}, async commit() {},
    async query() { return [{ affectedRows: 1 }]; },
    async execute(sql, params) {
      if (sql.includes("AND id <> ? FOR UPDATE")) {
        duplicateCheckParams = params;
        return [duplicateFound ? [{ id: "r2" }] : []];
      }
      if (sql.includes("WHERE id = ? FOR UPDATE")) return [[{
        id: "r1", academic_year: "2026-2027", degree_program: "Computing", status: state,
      }]];
      if (sql.includes("FOR UPDATE")) return [[{ id: "r1" }]];
      if (sql.includes("UPDATE program_annual_reports")) { updated = true; updateParams = params; }
      if (sql.includes("SELECT * FROM program_annual_reports")) return [[{ id: "r1", status: "draft" }]];
      if (sql.includes("SELECT issue, solution, recommendation")) return [[{
        issue: "Concern", solution: "Fix", recommendation: "Follow up",
      }]];
      return [{ affectedRows: 1 }];
    },
  });
  const request = { verifiedUser: { id: "admin", role: "admin" }, body: {
    reportId: "r1", academicYear: "2027-2028", degreeProgram: "Nursing",
    entries: [{ issue: "Concern", solution: "Fix", recommendation: "Follow up" }],
    status: "draft",
  } };
  const saved = response();
  await saveProgramAnnualReport(request, saved);
  assert.equal(saved.statusCode, 200);
  assert.equal(updated, true);
  assert.deepEqual(duplicateCheckParams, ["2027-2028", "Nursing", "r1"]);
  assert.deepEqual(updateParams.slice(0, 2), ["2027-2028", "Nursing"]);
  assert.deepEqual(saved.body.report.entries[0], {
    issue: "Concern", solution: "Fix", recommendation: "Follow up",
  });

  state = "submitted";
  updated = false;
  const rejected = response();
  await saveProgramAnnualReport(request, rejected);
  assert.equal(rejected.statusCode, 409);
  assert.equal(updated, false);

  state = "draft";
  duplicateFound = true;
  const conflictingEdit = response();
  await saveProgramAnnualReport(request, conflictingEdit);
  assert.equal(conflictingEdit.statusCode, 409);
  assert.equal(updated, false);

  duplicateFound = false;
  const duplicate = response();
  await saveProgramAnnualReport({ ...request, body: { ...request.body, reportId: undefined } }, duplicate);
  assert.equal(duplicate.statusCode, 409);
  assert.equal(updated, false);
});
