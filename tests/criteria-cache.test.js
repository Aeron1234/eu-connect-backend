import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { getStudentEvaluationCriteria, deactivateStudentEvaluationCriterion } from "../features/evaluation-criteria/controllers/evaluationsCriteriaController.js";
import { validateCriteriaScores } from "../features/evaluation-criteria/criteriaDepartment.js";
import { getStudentEvaluationCriteria as getEmployerForm } from "../features/evaluations/controllers/studentEvaluationControllers.js";
import { getEvaluationCriterias as getStudentForm } from "../features/evaluations/controllers/employerEvaluationsController.js";

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("management reads and mutations use the head's current department", async () => {
  const original = db.getConnection;
  const statements = [];
  db.getConnection = async () => ({ release() {}, async beginTransaction() {}, async commit() {}, async rollback() {}, async execute(sql, params) {
    statements.push([sql, params]);
    if (sql.includes("FROM dept_heads_background_info")) return [[{ department_id: 5, code: "CITHM" }]];
    if (sql.includes("FOR UPDATE")) return [[{ id: 9, is_active: 1 }]];
    if (sql.startsWith("UPDATE")) return [{ affectedRows: 1 }];
    return [[{ id: 9, category: "Service", criterion_name: "Hospitality", is_active: 1 }]];
  } });
  try {
    const req = { verifiedUser: { id: "head" }, query: {}, params: { criterionId: "9" } };
    const read = response(); await getStudentEvaluationCriteria(req, read);
    assert.equal(read.statusCode, 200);
    assert.match(statements[1][0], /WHERE department_id = \?/);
    assert.deepEqual(statements[1][1], [5]);
    const changed = response(); await deactivateStudentEvaluationCriterion(req, changed);
    assert.equal(changed.statusCode, 200);
    assert.deepEqual(statements.find(([sql]) => sql.includes("FOR UPDATE"))[1], ["9", 5]);
    assert.deepEqual(statements.find(([sql]) => sql.startsWith("UPDATE"))[1], ["9", 5]);
  } finally { db.getConnection = original; }
});

test("Registrar cannot read criteria even with a department assignment", async () => {
  const original = db.getConnection;
  db.getConnection = async () => ({ release() {}, async execute() { return [[{ department_id: 7, code: "REG" }]]; } });
  try {
    const res = response(); await getStudentEvaluationCriteria({ verifiedUser: { id: "registrar" }, query: {} }, res);
    assert.equal(res.statusCode, 403);
  } finally { db.getConnection = original; }
});

test("submissions require each active criterion ID exactly once", async () => {
  const connection = { async execute() { return [[{ id: 2 }, { id: 3 }]]; } };
  assert.equal(await validateCriteriaScores(connection, "student_evaluation_criteria", 3, [{ criterion_id: 2, score: 4 }, { criterion_id: 3, score: 0 }]), true);
  assert.equal(await validateCriteriaScores(connection, "student_evaluation_criteria", 3, [{ criterion_id: 2, score: 4 }, { criterion_id: 2, score: 5 }]), false);
  assert.equal(await validateCriteriaScores(connection, "student_evaluation_criteria", 3, [{ criterion_id: 2, score: 4 }, { criterion_id: 4, score: 5 }]), false);
  assert.equal(await validateCriteriaScores(connection, "student_evaluation_criteria", 3, [{ criterion_id: 2, score: 4 }]), false);
});

test("student and employer forms resolve the evaluated student's department", async () => {
  const original = db.getConnection;
  const calls = [];
  db.getConnection = async () => ({ release() {}, async execute(sql, params) {
    calls.push([sql, params]);
    if (sql.includes("FROM internship_records")) return [[{ id: "record" }]];
    if (sql.includes("FROM student_academic_info")) return [[{ department_id: 5 }]];
    return [[{ id: 12, category: "Service", criterion_name: "Care" }]];
  } });
  try {
    const student = response(); await getStudentForm({ verifiedUser: { id: "student" } }, student);
    assert.equal(student.statusCode, 200);
    assert.equal(student.body[0].items[0].id, 12);
    const employer = response(); await getEmployerForm({ verifiedUser: { id: "supervisor" }, query: { studentId: "student" } }, employer);
    assert.equal(employer.statusCode, 200);
    assert.deepEqual(calls.find(([sql]) => sql.includes("FROM internship_records"))[1], ["student", "supervisor"]);
    assert(calls.filter(([sql]) => sql.includes("WHERE department_id = ? AND is_active = 1")).every(([, params]) => params[0] === 5));
  } finally { db.getConnection = original; }
});
