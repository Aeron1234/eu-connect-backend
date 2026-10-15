import { test } from "node:test";
import assert from "node:assert/strict";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_KEY = "no-network";
const { db } = await import("../config/db.js");
const { getDepartmentInternshipRecords } = await import("../features/internship-records/controllers/internshipRecordControllers.js");

async function invoke({ role, query, summary, rows = [] }) {
  const original = db.getConnection;
  const calls = [];
  let released = 0;
  db.getConnection = async () => ({
    release() { released++; },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT department_id FROM dept_heads_background_info")) {
        return [[{ department_id: 7 }]];
      }
      if (sql.includes(" AS total,")) return [[summary]];
      if (sql.includes("ORDER BY ir.updated_at DESC")) return [rows];
      throw new Error("Unexpected query");
    },
  });
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    // Exercise the controller's SQL directly; route authorization and caching
    // are covered by the existing staff-list tests.
    await getDepartmentInternshipRecords({
      method: "POST",
      verifiedUser: { id: 12, role },
      query,
    }, res);
    return { calls, res, released };
  } finally {
    db.getConnection = original;
  }
}

test("department list keeps filtered pagination and unfiltered status cards", async () => {
  const summary = { total: 12, pending: 4, ongoing: 9, finished: 3, rejected: 2 };
  const row = {
    id: "record-1", user_id: "student-1", first_name: "Ana",
    last_name: "Santos", student_number: "123", company_name: "Acme",
    internship_position: "Intern", course_name: "BSIT", status: "ongoing",
    total_hours: 400, accumulated_hours: 20,
  };
  const { calls, res, released } = await invoke({
    role: "department_head",
    query: { status: "ongoing", search: "Ana", page: "2", limit: "5" },
    summary,
    rows: [row],
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.pagination, { page: 2, limit: 5, total: 12, totalPages: 3 });
  assert.deepEqual(res.body.stats, { pending: 4, ongoing: 9, finished: 3, rejected: 2 });
  assert.equal(res.body.data[0].student_name, "Ana Santos");
  assert.equal(res.body.data[0].student_id, "student-1");
  assert.equal(calls.length, 3);
  const [auth, aggregate, page] = calls;
  assert.deepEqual(auth.params, [12]);
  assert.deepEqual(aggregate.params, ["ongoing", ...Array(5).fill("%Ana%"), 7]);
  assert.deepEqual(page.params, [7, "ongoing", ...Array(5).fill("%Ana%"), 5, 5]);
  assert.match(aggregate.sql, /COUNT\(CASE WHEN ir\.status = \? AND/);
  assert.match(aggregate.sql, /WHERE ir\.deleted_at IS NULL AND sai\.department_id = \?/);
  assert.doesNotMatch(aggregate.sql, /GROUP BY ir\.status/);
  assert.match(page.sql, /ORDER BY ir\.updated_at DESC\s+LIMIT \? OFFSET \?/);
  assert.equal(released, 1);
});

test("admin list keeps all-status totals and empty response shape", async () => {
  const { calls, res } = await invoke({
    role: "admin",
    query: {},
    summary: { total: 0, pending: 0, ongoing: 0, finished: 0, rejected: 0 },
  });
  assert.deepEqual(res.body.data, []);
  assert.deepEqual(res.body.stats, { pending: 0, ongoing: 0, finished: 0, rejected: 0 });
  assert.deepEqual(res.body.pagination, { page: 1, limit: 10, total: 0, totalPages: 0 });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /SELECT COUNT\(\*\) AS total/);
  assert.deepEqual(calls[0].params, []);
  assert.deepEqual(calls[1].params, [10, 0]);
});
