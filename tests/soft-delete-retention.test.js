import test from "node:test";
import assert from "node:assert/strict";
import { purgeExpiredSoftDeletes, RETENTION_TABLES } from "../config/softDeleteRetention.js";

function fixture({ table = "internship_records", lock = 1, restored = false, fail = false } = {}) {
  const calls = []; const errors = []; let invalidated = 0;
  const connection = {
    execute: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("GET_LOCK")) return [[{ acquired: lock }]];
      if (sql.includes("ORDER BY deleted_at")) return [sql.includes(`FROM ${table} `) ? [{ id: "expired" }] : []];
      if (sql.includes("FOR UPDATE") && sql.includes("deleted_at <")) return [restored ? [] : [{ id: "expired" }]];
      if (sql.startsWith("SELECT")) return [[]];
      if (fail && sql.startsWith("DELETE")) throw new Error("delete failed");
      return [{ affectedRows: 1 }];
    },
    beginTransaction: async () => calls.push({ sql: "BEGIN" }),
    commit: async () => calls.push({ sql: "COMMIT" }),
    rollback: async () => calls.push({ sql: "ROLLBACK" }),
    release: () => calls.push({ sql: "RELEASE CONNECTION" }),
  };
  return { calls, errors, run: () => purgeExpiredSoftDeletes({ pool: { getConnection: async () => connection },
    queueFiles: async () => calls.push({ sql: "QUEUE FILES" }),
    invalidate: () => invalidated++, onError: error => errors.push(error),
  }), invalidated: () => invalidated };
}

test("retention covers only the five approved families and rechecks 30-day cutoff", async () => {
  assert.equal(RETENTION_TABLES.length, 5);
  assert(!RETENTION_TABLES.includes("users"));
  const f = fixture(); await f.run();
  const selections = f.calls.filter(c => c.sql.includes("deleted_at <"));
  assert(selections.every(c => c.sql.includes("DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)")));
  assert(f.calls.findIndex(c => c.sql === "QUEUE FILES") < f.calls.findIndex(c => c.sql === "DELETE FROM internship_records WHERE id = ?"));
  assert(f.calls.findIndex(c => c.sql.startsWith("DELETE FROM weekly_narratives")) < f.calls.findIndex(c => c.sql === "DELETE FROM internship_records WHERE id = ?"));
  assert.equal(f.invalidated(), 1);
});
test("overlapping workers skip without deleting", async () => {
  const f = fixture({ lock: 0 }); assert.equal((await f.run()).skipped, true);
  assert(!f.calls.some(c => c.sql.startsWith("DELETE")));
  assert.equal(f.calls.at(-1).sql, "RELEASE CONNECTION");
});
test("restored rows are skipped under lock", async () => {
  const f = fixture({ restored: true }); await f.run();
  assert(!f.calls.some(c => c.sql.startsWith("DELETE")));
  assert.equal(f.invalidated(), 0);
});
test("failed deletions roll back without invalidating and release the lock", async () => {
  const f = fixture({ table: "student_evaluation_masters", fail: true }); await f.run();
  assert.equal(f.errors.length, 1); assert.equal(f.invalidated(), 0);
  assert(f.calls.some(c => c.sql === "ROLLBACK"));
  assert(!f.calls.some(c => c.sql === "COMMIT"));
  assert(f.calls.some(c => c.sql.includes("RELEASE_LOCK")));
});
test("evaluation scores and notifications are removed before the evaluation", async () => {
  const f = fixture({ table: "student_evaluation_masters" }); await f.run();
  const deletions = f.calls.filter(c => c.sql.startsWith("DELETE"));
  assert(deletions[0].sql.includes("student_evaluation_scores"));
  assert(deletions[1].sql.includes("notifications"));
  assert(deletions[2].sql.includes("student_evaluation_masters"));
});
