import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_KEY = "no-network";
process.env.CACHE_ENABLED = "false";
const { db } = await import("../config/db.js");
const student = await import("../controllers/studentEvaluationControllers.js");
const employer = await import("../controllers/employerEvaluationsController.js");
const records = await import("../controllers/internshipRecordControllers.js");
const original = db.getConnection;
after(async () => { db.getConnection = original; await db.end(); });

async function invoke(handler, req, answer) {
  const calls = [];
  let releases = 0;
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(sql, params) { calls.push({ sql, params }); return [answer(sql, params)]; },
  });
  const res = {
    statusCode: 200, locals: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set() { return this; },
  };
  await handler({ method: "POST", verifiedUser: { id: "student", role: "student" }, params: {}, ...req }, res);
  return { res, calls, releases };
}

function score(id, label, value) {
  return {
    evaluation_id: id, evaluation_status: "pending", status: "pending",
    submitted_date: id === "first" ? "2026-09-02" : "2026-09-01",
    evaluator_id: "employer", evaluator: "Employer Name", actor_id: "employer",
    actor_name: "Employer Name", company: "Company", comments: "Good work",
    breakdown_label: label, breakdown_score: value,
  };
}
const scores = [score("first", "Skills", 3), score("first", "Skills", 4),
  score("first", "Teamwork", 5), score("second", "Skills", 2)];
const firstBreakdown = [{ label: "Skills", score: 7, max: 10 },
  { label: "Teamwork", score: 5, max: 5 }];

test("student detail retains item order within each category", async () => {
  const rows = [
    { category: "Skills", criterion_name: "A", score: 3 },
    { category: "Skills", criterion_name: "B", score: 4 },
    { category: "Teamwork", criterion_name: "C", score: 5 },
  ].map((row) => ({
    internship_record_id: "internship", company_name: "Company", internship_position: "Intern",
    internship_status: "ongoing", evaluation_master_id: "first", evaluated_by: "employer",
    other_remarks: "Good work", evaluation_date: "2026-09-02", ...row,
  }));
  const { res, releases } = await invoke(student.getStudentCompleteEvaluations,
    { params: { studentId: "student" } }, () => rows);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.evaluation_details.categories, [
    { category_name: "Skills", items: [{ criterion: "A", score: 3 }, { criterion: "B", score: 4 }] },
    { category_name: "Teamwork", items: [{ criterion: "C", score: 5 }] },
  ]);
  assert.equal(releases, 1);
});

test("past, pending and disputed views retain evaluation boundaries and totals", async () => {
  for (const [handler, req] of [
    [student.getPastStudentEvaluations, { params: { studentId: "student" } }],
    [employer.getPendingStudentEvaluations, {}],
    [student.getDisputedStudentEvaluations, {}],
  ]) {
    const { res, releases } = await invoke(handler, req, () => scores);
    assert.equal(res.statusCode, 200, handler.name);
    assert.deepEqual(res.body.data.map((item) => item.id), ["first", "second"]);
    assert.deepEqual(res.body.data[0].breakdown, firstBreakdown);
    assert.deepEqual(res.body.data[1].breakdown, [{ label: "Skills", score: 2, max: 5 }]);
    assert.equal(releases, 1, handler.name);
  }
});

test("all and record histories retain received and given evaluation shapes", async () => {
  for (const [handler, req] of [
    [student.getAllStudentEvaluations, {}],
    [records.getInternshipRecordEvaluations,
      { verifiedUser: { id: "admin", role: "admin" }, params: { internshipId: "internship" } }],
  ]) {
    const { res, releases } = await invoke(handler, req, (sql) => {
      if (sql.includes("SELECT ir.id, ir.deleted_at"))
        return [{ id: "internship", deleted_at: null, department_id: 1 }];
      if (sql.includes("FROM student_evaluation_masters")) return scores.slice(0, 3);
      if (sql.includes("FROM employer_evaluation_masters")) return scores.slice(3);
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    assert.equal(res.statusCode, 200, handler.name);
    const items = Array.isArray(res.body) ? res.body : res.body.data;
    assert.deepEqual(items.map((item) => item.type), ["Performance Evaluation", "Supervisor Evaluation"]);
    assert.deepEqual(items[0].breakdown, firstBreakdown);
    assert.deepEqual(items[1].breakdown, [{ label: "Skills", score: 2, max: 5 }]);
    assert.equal(releases, 1, handler.name);
  }
});

test("submitted evaluations group interleaved scores by master", async () => {
  const masters = [
    { id: "first", company_name: "Company A", employer_first_name: "Pat", employer_last_name: "Lee" },
    { id: "second", company_name: "Company B", employer_first_name: null, employer_last_name: null },
  ];
  const points = [
    { evaluation_master_id: "first", category: "Skills", score: 3 },
    { evaluation_master_id: "second", category: "Teamwork", score: 5 },
    { evaluation_master_id: "first", category: "Skills", score: 4 },
  ];
  const { res, calls, releases } = await invoke(employer.getStudentSubmittedEvaluations, {},
    (sql) => sql.includes("FROM employer_evaluation_masters") ? masters : points);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(res.body.map((item) => [item.id, item.total_score, item.total_max]),
    [["first", 7, 10], ["second", 5, 5]]);
  assert.deepEqual(res.body[0].categories, [{ category: "Skills", score: 7, max: 10 }]);
  assert.equal(res.body[1].employer_name, "Your Supervisor");
  assert.equal(releases, 1);
});

test("print retains its grouped response and checks ownership before reading scores", async () => {
  const header = {
    id: "evaluation", record_owner_id: "student", status: "completed",
    first_name: "Pat", last_name: "Lee", company_name: "Company",
    department_name: "Department", other_remarks: "Good work",
    created_at: "2026-09-02",
  };
  const points = [
    { category: "Skills", criterion_name: "A", score: 3 },
    { category: "Skills", criterion_name: "B", score: 4 },
    { category: "Teamwork", criterion_name: "C", score: 5 },
  ];
  const req = { params: { evaluationId: "evaluation" } };
  const ok = await invoke(student.getStudentEvaluationForPrint, req,
    (sql) => sql.includes("FROM student_evaluation_masters") ? [header] : points);
  assert.equal(ok.res.statusCode, 200);
  assert.equal(ok.calls.length, 2);
  assert.deepEqual(ok.calls.map((call) => call.params), [["evaluation"], ["evaluation"]]);
  assert.match(ok.calls[1].sql, /ORDER BY sec\.category ASC, sec\.id ASC/);
  assert.deepEqual(ok.res.body, {
    id: "evaluation", student_name: "Pat Lee", company_name: "Company",
    department_name: "Department", other_remarks: "Good work",
    created_at: "2026-09-02", categories: [
      { category: "Skills", items: [{ criterion_name: "A", score: 3 }, { criterion_name: "B", score: 4 }] },
      { category: "Teamwork", items: [{ criterion_name: "C", score: 5 }] },
    ],
  });
  assert.equal(ok.releases, 1);

  for (const [row, status] of [[null, 404], [{ ...header, record_owner_id: "other" }, 403],
    [{ ...header, status: "pending" }, 403]]) {
    const result = await invoke(student.getStudentEvaluationForPrint, req, () => row ? [row] : []);
    assert.equal(result.res.statusCode, status);
    assert.equal(result.calls.length, 1);
    assert.equal(result.releases, 1);
  }
  const denied = await invoke(student.getStudentEvaluationForPrint,
    { ...req, verifiedUser: { id: "student", role: "employer" } }, () => []);
  assert.equal(denied.res.statusCode, 403);
  assert.equal(denied.calls.length, 0);
});
