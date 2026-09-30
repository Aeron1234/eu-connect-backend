import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import {
  getAvailableAcademicYears,
  getHteCompanyList,
  getHteCompanyReport,
} from "../controllers/hteReportControllers.js";

async function invoke(handler, query, responses) {
  const original = db.getConnection;
  const calls = [];
  let released = 0;
  db.getConnection = async () => ({
    release() { released++; },
    async execute(sql, params = []) {
      calls.push({ sql, params });
      return [responses[calls.length - 1] ?? []];
    },
  });
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    // Cache and route authorization are exercised by reports-cache.test.js.
    await handler({ method: "POST", verifiedUser: { id: "admin", role: "admin" }, query }, res);
    return { calls, res, released };
  } finally {
    db.getConnection = original;
  }
}

const intern = {
  company_name: "Company", company_address: "City", company_key: "key",
  first_name: "Ana", last_name: "Santos", gender: "F", course_name: "BSIT",
  date_started: "2026-08-01", date_ended: "2027-01-01",
};

test("company page uses the indexed date window in count, page, and intern queries", async () => {
  const { calls, res, released } = await invoke(
    getHteCompanyList,
    { academicYear: "2026-2027", search: "Ana", page: "2", limit: "5" },
    [[{ total: 11 }], [{ company_key: "key", company_name: "Company", company_address: "City", intern_count: 1 }], [intern]],
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.pagination, { page: 2, limit: 5, total: 11, totalPages: 3 });
  assert.equal(res.body.companies[0].interns[0].name, "Ana Santos");
  assert.deepEqual(calls[0].params, ["2026-2027", "2026-01-01", "2028-01-01", ...Array(4).fill("%Ana%")]);
  assert.deepEqual(calls[1].params, [...calls[0].params, 5, 5]);
  assert.deepEqual(calls[2].params, ["2026-2027", "2026-01-01", "2028-01-01", "key"]);
  for (const { sql } of calls) {
    assert.match(sql, /ir\.academic_year = \?/);
    assert.match(sql, /ir\.date_started >= \?/);
    assert.match(sql, /ir\.date_started < \?/);
  }
  assert.equal(released, 1);
});

test("both company detail routes keep their response and date-bound parameters", async () => {
  for (const [handler, query] of [
    [getHteCompanyList, { academicYear: "2026-2027", companyKey: "key" }],
    [getHteCompanyReport, { academicYear: "2026-2027", companyKey: "key" }],
  ]) {
    const { calls, res } = await invoke(handler, query, [[intern]]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.academicYear, "2026-2027");
    assert.equal(res.body.company_name, "Company");
    assert.deepEqual(res.body.interns[0], {
      name: "Ana Santos", course: "BSIT", gender: "F",
      date_started: "2026-08-01", date_ended: "2027-01-01",
    });
    assert.deepEqual(calls[0].params, ["2026-2027", "2026-01-01", "2028-01-01", "key"]);
    assert.match(calls[0].sql, /ir\.academic_year = \?[\s\S]*ir\.date_started >= \?[\s\S]*ir\.date_started < \?[\s\S]*MD5\(CONCAT/);
  }
});

test("academic-year lookup stays exact and unusual years use the original HTE predicate", async () => {
  const years = await invoke(getAvailableAcademicYears, {}, [[{ academic_year: "2026-2027" }]]);
  assert.deepEqual(years.res.body, ["2026-2027"]);
  assert.doesNotMatch(years.calls[0].sql, /date_started >=/);

  const extreme = await invoke(getHteCompanyReport,
    { academicYear: "9998-9999", companyKey: "key" }, [[intern]]);
  assert.equal(extreme.res.statusCode, 200);
  assert.deepEqual(extreme.calls[0].params, ["9998-9999", "key"]);
  assert.doesNotMatch(extreme.calls[0].sql, /date_started >=/);
});
