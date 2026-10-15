import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { supabase } from "../config/supabase.js";
import { approveInternshipDocument, deleteFile } from "../features/documents/controllers/fileControllers.js";

const originalGetConnection = db.getConnection;
const originalStorageFrom = supabase.storage.from;

after(async () => {
  db.getConnection = originalGetConnection;
  supabase.storage.from = originalStorageFrom;
  await db.end();
});

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function runDocumentAction(handler, { status = "pending", uploaderRole = "employer", actorRole = "student", failCommit = false } = {}) {
  const notifications = [];
  const emitted = [];
  const document = {
    id: 41,
    user_id: "student-id",
    file_name: "Completion Certificate",
    path: "requirements/student-id/certificate.pdf",
    uploaded_by_id: "employer-id",
    uploaded_by_role: uploaderRole,
    verification_status: status,
  };
  let committed = false;
  let rolledBack = false;
  db.getConnection = async () => ({
    async beginTransaction() {},
    async rollback() { rolledBack = true; },
    async commit() {
      if (failCommit) throw new Error("Commit failed");
      committed = true;
    },
    release() {},
    async execute(sql, params) {
      if (sql.includes("FROM internship_documents WHERE id = ? FOR UPDATE")) return [[document]];
      if (sql.startsWith("INSERT INTO notifications")) notifications.push(params);
      return [{ affectedRows: 1 }];
    },
  });
  supabase.storage.from = () => ({ remove: async () => ({ error: null }) });
  const request = {
    verifiedUser: { id: actorRole === "admin" ? "admin-id" : "student-id", role: actorRole },
    params: { fileId: "41" },
    app: { get: () => ({ to: (room) => ({ emit: (event, payload) => {
      assert.ok(committed, "notification must be emitted after commit");
      emitted.push({ room, event, payload });
    } }) }) },
  };
  const res = response();
  return handler(request, res).then(() => ({ res, notifications, emitted, committed, rolledBack }));
}

test("accepting an employer upload notifies its uploader after commit", async () => {
  const { res, notifications, emitted } = await runDocumentAction(approveInternshipDocument);
  assert.equal(res.statusCode, 200);
  assert.equal(notifications.length, 1);
  assert.deepEqual(notifications[0].slice(0, 3), ["employer-id", "student-id", "certificate_accepted"]);
  assert.equal(notifications[0][5], "student-id");
  assert.deepEqual(emitted.map(({ room, payload }) => [room, payload.type]), [["user-employer-id", "certificate_accepted"]]);
});

test("student deletion notifies the employer only for their pending upload", async () => {
  const pending = await runDocumentAction(deleteFile);
  assert.equal(pending.res.statusCode, 200);
  assert.equal(pending.notifications.length, 1);
  assert.equal(pending.notifications[0][2], "certificate_rejected");
  assert.match(pending.notifications[0][4], /deleted your pending file/);
  assert.equal(pending.emitted[0].room, "user-employer-id");

  for (const options of [
    { status: "accepted" },
    { uploaderRole: "student" },
    { actorRole: "admin" },
  ]) {
    const result = await runDocumentAction(deleteFile, options);
    assert.equal(result.res.statusCode, 200);
    assert.equal(result.notifications.length, 0);
    assert.equal(result.emitted.length, 0);
  }
});

test("failed transactions do not emit employer document notifications", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    for (const handler of [approveInternshipDocument, deleteFile]) {
      const result = await runDocumentAction(handler, { failCommit: true });
      assert.equal(result.res.statusCode, 500);
      assert.ok(result.rolledBack);
      assert.equal(result.emitted.length, 0);
    }
  } finally {
    console.error = originalConsoleError;
  }
});
