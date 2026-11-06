import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import {
  addStudentEvaluationCriterion,
  getStudentEvaluationCriteria,
} from "../features/evaluation-criteria/controllers/evaluationsCriteriaController.js";

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("new student evaluation categories omit a leading number and dot", async () => {
  const original = db.getConnection;
  let inserted;
  db.getConnection = async () => ({
    release() {},
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async execute(sql, params) {
      if (sql.includes("FROM dept_heads_background_info")) return [[{ department_id: 3, code: "CCS" }]];
      assert.match(sql, /INSERT INTO student_evaluation_criteria/);
      inserted = params;
      return [{ affectedRows: 1, insertId: 30 }];
    },
  });
  try {
    const res = response();
    await addStudentEvaluationCriterion({ verifiedUser: { id: "head" }, body: { category: "7. Communication", criterion_name: "Clarity" } }, res);
    assert.equal(res.statusCode, 201);
    assert.deepEqual(inserted, [3, "Communication", "Clarity"]);
  } finally {
    db.getConnection = original;
  }
});

test("student evaluation sections retain first-criterion order after prefixes are removed", async () => {
  const original = db.getConnection;
  let statement;
  db.getConnection = async () => ({
    release() {},
    async execute(sql) {
      if (sql.includes("FROM dept_heads_background_info")) return [[{ department_id: 3, code: "CCS" }]];
      statement = sql;
      return [[
        { id: 1, category: "Personality", criterion_name: "Grooming", is_active: 1 },
        { id: 5, category: "Work Attitude", criterion_name: "Attendance", is_active: 1 },
      ]];
    },
  });
  try {
    const res = response();
    await getStudentEvaluationCriteria({ verifiedUser: { id: "head" }, query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.match(statement, /ORDER BY id ASC/);
    assert.deepEqual(res.body.map((group) => group.category), ["Personality", "Work Attitude"]);
  } finally {
    db.getConnection = original;
  }
});
