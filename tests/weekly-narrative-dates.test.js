import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { db } from "../config/db.js";
import cache from "../config/cache/cache.js";
import { parseNarrativeDateRange } from "../features/weekly-narratives/narrativeDates.js";
import { createWeeklyNarrative, editWeeklyNarrative, getWeeklyNarrativesForPrint, getAllWeeklyNarratives, getSearchedStudentWeeklyNarratives, getInternshipRecordWeeklyNarratives } from "../features/weekly-narratives/controllers/weeklyNarrativeControllers.js";

const originals = { execute: db.execute, getConnection: db.getConnection };
beforeEach(() => cache.flushAll());
after(async () => { db.execute = originals.execute; db.getConnection = originals.getConnection; cache.close(); await db.end(); });
const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });
const req = (dates = {}) => ({ verifiedUser: { id: "student", role: "student" }, params: { narrativeId: "entry", internshipId: "record", searchedUserId: "student" }, query: { internshipId: "record" }, body: { week_number: 1, title: "Weekly work", narrative: "Completed my tasks", ...dates } });

test("date validation accepts inclusive same-day and leap-day ranges without guessing missing values", () => {
  assert.deepEqual(parseNarrativeDateRange({ date_from: " 2024-02-29 ", date_to: "2024-02-29" }), { from: "2024-02-29", to: "2024-02-29" });
  for (const dates of [{}, { date_from: "2026-10-19" }, { date_to: "2026-10-23" }, { date_from: "2026-02-29", date_to: "2026-03-01" }, { date_from: "2026-04-31", date_to: "2026-05-01" }, { date_from: "2026-10-23", date_to: "2026-10-19" }, { date_from: "2026-10-19T00:00:00Z", date_to: "2026-10-23" }, { date_from: ["2026-10-19"], date_to: "2026-10-23" }]) {
    assert.throws(() => parseNarrativeDateRange(dates), { status: 400, code: "INVALID_NARRATIVE_DATE_RANGE" });
  }
});

test("invalid ranges are rejected on both mutation endpoints before writes or cache invalidation", async () => {
  for (const action of [createWeeklyNarrative, editWeeklyNarrative]) {
    for (const dates of [{}, { date_from: "2026-10-23", date_to: "2026-10-19" }, { date_from: "2026-02-30", date_to: "2026-03-01" }]) {
      let connections = 0;
      db.getConnection = async () => { connections++; throw new Error("must not reach database"); };
      cache.set("history", { path: "/api/v1/weekly-narratives/history", body: {} });
      const res = response(); await action(req(dates), res);
      assert.equal(res.statusCode, 400); assert.equal(res.body.code, "INVALID_NARRATIVE_DATE_RANGE");
      assert.equal(connections, 0); assert(cache.has("history"));
    }
  }
});

test("both writes persist the exact range within the existing internship lock and commit", async () => {
  for (const action of [createWeeklyNarrative, editWeeklyNarrative]) {
    let locked = false, committed = false, saved;
    cache.set("history", { path: "/api/v1/weekly-narratives/history", body: {} });
    db.getConnection = async () => ({ release() {}, async beginTransaction() {}, async rollback() {}, async commit() { assert(cache.has("history")); committed = true; },
      async execute(sql, params) {
        if (sql.includes("FROM internship_records")) { assert.match(sql, /FOR UPDATE/); locked = true; return [[{ id: "record", date_started: "2000-01-01" }]]; }
        assert(locked); saved = { sql, params }; return [{ affectedRows: 1 }];
      } });
    const res = response(); await action(req({ date_from: "2026-10-19", date_to: "2026-10-23" }), res);
    assert(res.statusCode < 300); assert(committed); assert(!cache.has("history"));
    assert.match(saved.sql, /date_from/); assert.match(saved.sql, /date_to/);
    assert(saved.params.includes("2026-10-19")); assert(saved.params.includes("2026-10-23"));
    if (action === editWeeklyNarrative) assert.deepEqual(saved.params.slice(-3), ["entry", "student", "record"]);
  }
});

test("all narrative reads return date-only ranges including nullable legacy records", async () => {
  const entries = [{ id: 1, week_number: 1, date_from: "2026-10-19", date_to: "2026-10-23" }, { id: 2, week_number: 2, date_from: null, date_to: null }];
  const queries = [];
  const execute = async (sql) => {
    queries.push(sql);
    if (sql.includes("FROM internship_records")) return [[{ id: "record", deleted_at: null, student_id: "student" }]];
    assert.match(sql, /DATE_FORMAT\((?:wn\.)?date_from, '%Y-%m-%d'\) AS date_from/);
    assert.match(sql, /DATE_FORMAT\((?:wn\.)?date_to, '%Y-%m-%d'\) AS date_to/);
    return [entries.map((entry) => ({ ...entry, total_entries: 2, latest_week: 2, total_words: 10, entries_this_week: 2, total_narratives: 2 }))];
  };
  db.execute = execute; db.getConnection = async () => ({ execute, release() {} });
  for (const action of [getWeeklyNarrativesForPrint, getAllWeeklyNarratives, getSearchedStudentWeeklyNarratives, getInternshipRecordWeeklyNarratives]) {
    const res = response(); const request = req();
    if (action === getInternshipRecordWeeklyNarratives) request.verifiedUser.role = "admin";
    await action(request, res); assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const rows = Array.isArray(res.body) ? res.body : res.body.narratives;
    assert.deepEqual(rows.map(({ date_from, date_to }) => ({ date_from, date_to })), entries.map(({ date_from, date_to }) => ({ date_from, date_to })));
  }
  assert(queries.length >= 4);
});

test("migration adds rerunnable nullable date columns without inventing old coverage dates", () => {
  const sql = readFileSync(new URL("../scripts/2026-10-22-weekly-narrative-date-range.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS date_from DATE NULL DEFAULT NULL/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS date_to DATE NULL DEFAULT NULL/);
  assert.doesNotMatch(sql, /\bUPDATE\s+weekly_narratives|\bDROP\s+COLUMN|\bDELETE\s+FROM/i);
});
