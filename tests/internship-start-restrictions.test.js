import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { supabase } from "../config/supabase.js";
import cache from "../config/cache/cache.js";
import { assertInternshipStarted, getInternshipStartAccess, manilaCalendarDay } from "../config/internshipStart.js";
import { createWeeklyNarrative, editWeeklyNarrative, getWeeklyNarrativesForPrint } from "../features/weekly-narratives/controllers/weeklyNarrativeControllers.js";
import { saveSummaryReport, listSummaryReports, getSummaryAttachment } from "../features/summary-reports/controllers/summaryReportControllers.js";
import { createStudentEvaluation } from "../features/evaluations/controllers/studentEvaluationControllers.js";
import { getSearchedUser } from "../features/users/controllers/searchedUserController.js";

const originals = { execute: db.execute, getConnection: db.getConnection, storage: supabase.storage.from };
beforeEach(() => cache.flushAll());
after(async () => {
  db.execute = originals.execute; db.getConnection = originals.getConnection;
  supabase.storage.from = originals.storage; cache.close(); await db.end();
});
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, set() { return this; }, json(body) { this.body = body; return this; } });
const paragraphs = { organization_experience: "Organization", work_schedule: "Schedule", memorable_moment: "Moment", difficulties_solutions: "Solutions" };
const request = (method = "POST") => ({ method, verifiedUser: { id: "student", role: "student" }, params: { internshipId: "internship", narrativeId: "narrative" }, query: { internshipId: "internship" }, body: { ...paragraphs, week_number: 1, title: "Week", narrative: "Activities", date_from: "2026-10-19", date_to: "2026-10-23" } });

function fixture({ dateStarted = "2000-01-01", status = "ongoing", owner = "student", deleted = false, existing = null } = {}) {
  const state = { writes: [], reads: [], commits: 0, rollbacks: 0, releases: 0 };
  db.getConnection = async () => ({
    async beginTransaction() {}, async commit() { state.commits++; },
    async rollback() { state.rollbacks++; }, release() { state.releases++; },
    async execute(sql, params) {
      if (/^SELECT id FROM student_evaluation_masters/.test(sql.trim())) return [[]];
      if (sql.includes("FROM internship_records")) {
        state.reads.push({ sql, params });
        assert.deepEqual(params, ["internship", "student"]);
        const owned = !sql.includes("user_id = ?") || owner === params[1];
        const live = !sql.includes("deleted_at IS NULL") || !deleted;
        const eligible = sql.includes("status IN ('ongoing', 'finished')") ? ["ongoing", "finished"].includes(status) : !sql.includes("status = 'ongoing'") || status === "ongoing";
        return [owned && live && eligible ? [{ id: "internship", date_started: dateStarted }] : []];
      }
      if (sql.includes("FROM summary_report_images")) return [[]];
      if (sql.includes("FROM summary_reports")) return [existing ? [existing] : []];
      state.writes.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  });
  return state;
}

test("start access switches exactly at Philippine midnight, including ISO dates", () => {
  const before = new Date("2026-10-21T15:59:59.999Z");
  const midnight = new Date("2026-10-21T16:00:00.000Z");
  for (const start of ["2026-10-22", "2026-10-21T16:00:00Z", new Date("2026-10-21T16:00:00Z")]) {
    assert.equal(getInternshipStartAccess(start, "Weekly narratives", before).allowed, false);
    assert.equal(getInternshipStartAccess(start, "Weekly narratives", midnight).allowed, true);
  }
  assert.match(getInternshipStartAccess("2026-10-22", "Summary reports", before).message, /October 22, 2026.*Philippine time/);
  for (const start of [null, "", "not a date", "0000-00-00", "2026-02-30"]) {
    assert.equal(manilaCalendarDay(start), null);
    assert.throws(() => assertInternshipStarted(start, "Summary reports", midnight), { status: 409 });
  }
});

test("direct weekly creation and editing reject future or missing dates without writes or cache invalidation", async () => {
  for (const action of [createWeeklyNarrative, editWeeklyNarrative]) {
    for (const dateStarted of ["2099-01-01", null, "2026-02-30"]) {
      const state = fixture({ dateStarted });
      cache.set("weekly-history", { path: "/api/v1/weekly-narratives/history", userId: "student", body: {} });
      const res = response(); await action(request(), res);
      assert.equal(res.statusCode, 409); assert.equal(res.body.code, "INTERNSHIP_NOT_STARTED");
      assert.match(res.body.error, /start|starting/i);
      assert.equal(state.writes.length, 0); assert.equal(state.commits, 0);
      assert.equal(state.rollbacks, 1); assert.equal(state.releases, 1);
      assert.equal(cache.has("weekly-history"), true);
    }
  }
});

test("weekly writes require an owned, live, ongoing internship and lock it before saving", async () => {
  for (const action of [createWeeklyNarrative, editWeeklyNarrative]) {
    for (const options of [{ owner: "someone-else" }, { deleted: true }, { status: "pending" }, { status: "finished" }, { status: "rejected" }]) {
      const state = fixture(options), res = response(); await action(request(), res);
      assert.equal(res.statusCode, 404); assert.equal(state.writes.length, 0);
    }
    const state = fixture(), res = response(); await action(request(), res);
    assert(res.statusCode < 300); assert.equal(state.writes.length, 1); assert.equal(state.commits, 1);
    assert.match(state.reads[0].sql, /FOR UPDATE/);
  }
});

test("weekly writes unlock on the first Manila day, even while UTC is still the previous date", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-21T15:59:59.999Z") });
  for (const action of [createWeeklyNarrative, editWeeklyNarrative]) {
    const state = fixture({ dateStarted: "2026-10-22" }), res = response(); await action(request(), res);
    assert.equal(res.statusCode, 409); assert.equal(state.writes.length, 0);
  }
  t.mock.timers.tick(1);
  for (const action of [createWeeklyNarrative, editWeeklyNarrative]) {
    const state = fixture({ dateStarted: "2026-10-22" }), res = response(); await action(request(), res);
    assert(res.statusCode < 300); assert.equal(state.commits, 1);
  }
});

test("summary creation and editing are blocked before the start date but allowed during or after internship", async () => {
  for (const method of ["POST", "PATCH"]) {
    const existing = method === "PATCH" ? { id: "report", attachment_path: null } : null;
    for (const dateStarted of ["2099-01-01", null]) {
      const state = fixture({ dateStarted, existing }), res = response(); await saveSummaryReport(request(method), res);
      assert.equal(res.statusCode, 409); assert.equal(state.writes.length, 0); assert.equal(state.rollbacks, 1);
    }
    for (const status of ["ongoing", "finished"]) {
      const state = fixture({ status, existing }), res = response(); await saveSummaryReport(request(method), res);
      assert(res.statusCode < 300); assert.equal(state.commits, 1); assert.equal(state.writes.length, 1);
    }
  }
});

test("saved narrative PDFs, report reads and attachments remain accessible before the start date", async () => {
  db.execute = async sql => sql.includes("FROM internship_records")
    ? [[{ id: "internship", internship_id: "internship", company_name: "Company", date_started: "2099-01-01", report_id: "report" }]]
    : sql.includes("FROM weekly_narratives") ? [[{ week_number: 1, title: "Saved", narrative: "Saved entry" }]]
      : sql.includes("FROM summary_report_images") ? [[]] : [[{ attachment_path: "saved.pdf" }]];
  supabase.storage.from = () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://example.test/saved.pdf" } }) });
  for (const action of [getWeeklyNarrativesForPrint, listSummaryReports, getSummaryAttachment]) {
    const res = response(); await action(request("GET"), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  }
});

function evaluationFixture({ dateStarted = "2000-01-01", status = "ongoing", deleted = false, supervisor = "employer" } = {}) {
  const state = { writes: [], reads: [], commits: 0, rollbacks: 0, releases: 0, events: 0 };
  db.getConnection = async () => ({
    async beginTransaction() {}, async commit() { state.commits++; },
    async rollback() { state.rollbacks++; }, release() { state.releases++; },
    async execute(sql, params) {
      if (sql.includes("FROM internship_records")) {
        state.reads.push({ sql, params });
        assert.deepEqual(params, ["student"]);
        assert.match(sql, /FOR UPDATE/);
        assert.match(sql, /DATE_FORMAT\(date_started, '%Y-%m-%d'\)/);
        assert.match(sql, /deleted_at IS NULL/);
        assert.match(sql, /status = 'ongoing'/);
        return [status === "ongoing" && !deleted ? [{ id: "internship", company_name: "Company", employer_id: supervisor, date_started: dateStarted }] : []];
      }
      if (sql.includes("FROM user_profiles")) return [[{ first_name: "Test", last_name: "Supervisor" }]];
      if (sql.includes("SELECT DISTINCT u.id")) return [[{ id: "department-head" }]];
      state.writes.push({ sql, params }); return [{ affectedRows: 1 }];
    },
  });
  const req = {
    verifiedUser: { id: "employer", role: "employer" },
    body: { student_id: "student", evaluated_by: "employer", scores: Array.from({ length: 29 }, (_, i) => ({ criterion_name: `Criterion ${i}`, score: 4 })) },
    app: { get: () => ({ to: () => ({ emit: () => { assert.equal(state.commits, 1); state.events++; } }) }) },
  };
  for (const [key, path] of [["evaluations", "/evaluations/all"], ["notifications", "/notifications"], ["activity", "/activity-logs"]]) {
    cache.set(key, { path: `/api/v1${path}`, userId: "student", body: [] });
  }
  return { state, req };
}

test("employer evaluation rejects future, missing and invalid start dates without saving or notifying", async () => {
  for (const dateStarted of ["2099-01-01", null, "0000-00-00", "2026-02-30"]) {
    const { state, req } = evaluationFixture({ dateStarted }), res = response();
    await createStudentEvaluation(req, res);
    assert.equal(res.statusCode, 409); assert.equal(res.body.code, "INTERNSHIP_NOT_STARTED");
    assert.match(res.body.error, /start|starting/i);
    assert.equal(state.writes.length, 0); assert.equal(state.commits, 0); assert.equal(state.events, 0);
    assert.equal(state.rollbacks, 1); assert.equal(state.releases, 1);
    assert.deepEqual(cache.keys().sort(), ["activity", "evaluations", "notifications"]);
  }
});

test("employer evaluation unlocks exactly at Manila midnight and invalidates caches only after saving", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-21T15:59:59.999Z") });
  let current = evaluationFixture({ dateStarted: "2026-10-22" }), res = response();
  await createStudentEvaluation(current.req, res);
  assert.equal(res.statusCode, 409); assert.equal(current.state.writes.length, 0);
  t.mock.timers.tick(1);
  current = evaluationFixture({ dateStarted: "2026-10-22" }); res = response();
  await createStudentEvaluation(current.req, res);
  assert.equal(res.statusCode, 201); assert.equal(current.state.commits, 1); assert.equal(current.state.events, 1);
  assert.equal(current.state.releases, 1); assert.equal(current.state.rollbacks, 0);
  assert.equal(current.state.writes.filter(({ sql }) => sql.includes("student_evaluation_scores")).length, 29);
  assert.equal(current.state.writes.filter(({ sql }) => sql.includes("INSERT INTO notifications")).length, 1);
  assert.deepEqual(cache.keys(), []);
});

test("evaluation requires the current live ongoing internship and authenticated accepted supervisor", async () => {
  for (const options of [{ deleted: true }, { status: "pending" }, { status: "finished" }, { supervisor: "other" }]) {
    const { state, req } = evaluationFixture(options), res = response();
    await createStudentEvaluation(req, res);
    assert.equal(res.statusCode, options.supervisor ? 403 : 404);
    assert.equal(state.writes.length, 0); assert.equal(state.events, 0); assert.equal(state.releases, 1);
  }
  const { state, req } = evaluationFixture(), res = response();
  req.verifiedUser.id = "different-employer"; // A forged body cannot claim to be the supervisor.
  await createStudentEvaluation(req, res);
  assert.equal(res.statusCode, 403); assert.equal(state.writes.length, 0);
});

test("the searched student profile carries the ongoing internship calendar date for evaluation access", async () => {
  let releases = 0;
  db.getConnection = async () => ({ release() { releases++; }, async execute(sql) {
    assert.match(sql, /DATE_FORMAT\(ir.date_started, '%Y-%m-%d'\) AS student_internship_date_started/);
    assert.match(sql, /ir.status = 'ongoing'/); assert.match(sql, /ir.deleted_at IS NULL/);
    return [[{ user_id: "student", role_name: "student", student_internship_id: "internship", student_internship_employer_id: "employer", student_internship_date_started: "2026-10-22" }]];
  } });
  const res = response();
  await getSearchedUser({ params: { searchedUserId: "student" }, verifiedUser: { id: "employer", role: "employer" } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.user.info.internship_date_started, "2026-10-22");
  assert.equal(res.body.user.supervision.status, "accepted"); assert.equal(releases, 1);
});
