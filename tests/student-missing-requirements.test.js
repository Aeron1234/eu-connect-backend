import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { db } from "../config/db.js";
import { getStudentDashboardStats } from "../features/dashboard/controllers/dashboardController.js";

// Exercise the actual, portable SELECT against isolated fixture data.
// Never connect to the configured application database.
function fixture(t) {
  const memory = new DatabaseSync(":memory:");
  memory.exec(
    "CREATE TABLE internship_favorites (student_id TEXT, favorited_at TEXT);" +
    "CREATE TABLE notifications (user_id TEXT, type TEXT, is_read INTEGER);" +
    "CREATE TABLE internship_records (id TEXT, user_id TEXT, status TEXT, deleted_at TEXT, created_at TEXT);" +
    "CREATE TABLE requirement_types (id INTEGER PRIMARY KEY, category TEXT);" +
    "CREATE TABLE internship_documents (id TEXT PRIMARY KEY, user_id TEXT, internship_id TEXT, requirement_type_id INTEGER, verification_status TEXT);" +
    "INSERT INTO requirement_types VALUES (1,'before'),(2,'before'),(3,'after'),(4,'after'),(5,'other');" +
    "INSERT INTO internship_records VALUES ('current','student','ongoing',NULL,'2026-10-20'),('past','student','finished',NULL,'2026-09-01'),('another','other','ongoing',NULL,'2026-10-21');"
  );
  const original = db.getConnection;
  let calls = 0, releases = 0;
  db.getConnection = async () => ({
    async execute(sql, params) { calls++; return [memory.prepare(sql).all(...params)]; },
    release() { releases++; },
  });
  t.after(() => { db.getConnection = original; memory.close(); });
  return {
    memory,
    add(id, owner, record, requirement, status = null) {
      memory.prepare("INSERT INTO internship_documents VALUES (?,?,?,?,?)").run(id, owner, record, requirement, status);
    },
    async stats() {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await getStudentDashboardStats({ verifiedUser: { id: "student" } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(releases, calls);
      return res.body.stats;
    },
  };
}

test("missing requirements count categories, not files, scoped to the ongoing internship and owner", async t => {
  const f = fixture(t);
  f.add("one", "student", "current", 1);
  f.add("duplicate", "student", "current", 1);
  f.add("accepted", "student", "current", 3, "accepted");
  f.add("old-file", "student", "past", 2);
  f.add("other-owner", "other", "current", 4);
  f.add("unclassified", "student", "current", null);
  const stats = await f.stats();
  assert.equal(stats.hasOngoingInternship, true);
  assert.equal(stats.missingRequirements, 2);
  assert.equal(stats.documentsStored, 5); // Existing all-internship upload count is preserved.
});

test("pending or rejected employer files do not satisfy a category until accepted", async t => {
  const f = fixture(t);
  f.add("pending", "student", "current", 1, "pending");
  f.add("rejected", "student", "current", 2, "rejected");
  assert.equal((await f.stats()).missingRequirements, 4);
  f.memory.exec("UPDATE internship_documents SET verification_status='accepted' WHERE id='pending'");
  assert.equal((await f.stats()).missingRequirements, 3);
  f.memory.exec("DELETE FROM internship_documents WHERE id='pending'");
  assert.equal((await f.stats()).missingRequirements, 4);
});

test("all categories uploaded produces zero, while no ongoing record produces null", async t => {
  const f = fixture(t);
  for (let type = 1; type <= 4; type++) f.add("doc-" + type, "student", "current", type);
  assert.equal((await f.stats()).missingRequirements, 0);
  for (const status of ["pending", "rejected", "finished"]) {
    f.memory.prepare("UPDATE internship_records SET status=? WHERE id='current'").run(status);
    const stats = await f.stats();
    assert.equal(stats.hasOngoingInternship, false);
    assert.equal(stats.missingRequirements, null);
  }
  f.memory.exec("UPDATE internship_records SET status='ongoing',deleted_at='2026-10-25' WHERE id='current'");
  assert.equal((await f.stats()).missingRequirements, null);
});

test("the most recently created ongoing record is used and an empty checklist is complete", async t => {
  const f = fixture(t);
  for (let type = 1; type <= 4; type++) f.add("doc-" + type, "student", "current", type);
  f.memory.exec("INSERT INTO internship_records VALUES ('new','student','ongoing',NULL,'2026-10-24')");
  assert.equal((await f.stats()).missingRequirements, 4);
  f.memory.exec("DELETE FROM requirement_types");
  const stats = await f.stats();
  assert.equal(stats.hasOngoingInternship, true);
  assert.equal(stats.missingRequirements, 0);
});
