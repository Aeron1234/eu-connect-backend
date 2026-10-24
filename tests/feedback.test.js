import test from "node:test";
import assert from "node:assert/strict";
import { createFeedbackService } from "../features/feedback/feedbackService.js";
import { validatePost, feedbackScope, uniqueRecipients, attachmentType } from "../features/feedback/feedbackPolicy.js";

const id = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const employer = { id: id(1), role: "employer" };
const input = (ids = []) => ({ category: ids.length ? "internship_feedback" : "platform_feedback", subject: "A useful update", description: "Details", internshipIds: ids });
function fixture({ tags = [], recipients = [], access = true, role = "employer", commitError = false, insertError = false, status = "open" } = {}) {
  const calls = [], notifications = [], delivery = [];
  let released = 0, rolledBack = 0, committed = 0;
  const connection = {
    async beginTransaction() {}, async commit() { committed++; if (commitError) throw new Error("commit disconnected"); },
    async rollback() { rolledBack++; }, release() { released++; },
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM internship_records")) return [tags];
      if (sql.includes("SELECT DISTINCT u.id")) return [recipients];
      if (sql.includes("INSERT INTO notifications")) { notifications.push(values); if (insertError) throw new Error("notification failed"); return [{ insertId: notifications.length }]; }
      if (sql.startsWith("SELECT COUNT(*) AS total FROM feedback_posts")) return [[{ total: access ? 1 : 0 }]];
      if (sql.includes("FROM feedback_posts p")) return [access ? [{ id: values[0] || id(99), author_id: values[1] || employer.id, subject: "Hello", status }] : []];
      if (sql.includes("SELECT post_id, student_name")) return [[]];
      if (sql.includes("SELECT internship_id")) return [[{ internship_id: id(3), department_id: 2, department_code: "CCS" }]];
      if (sql.includes("SELECT id, filename")) return [[{ id: id(7), filename: "test.pdf" }]];
      if (sql.includes("SELECT storage_path")) return [[{ storage_path: "feedback/private.pdf", filename: "test.pdf" }]];
      if (sql.includes("SELECT fr.id")) {
        return [[{ id: id(20), body: "Public reply", is_internal: 0 }, ...(role === "employer" ? [] : [{ id: id(21), body: "Staff note", is_internal: 1 }])]];
      }
      if (sql.includes("SELECT id, created_at")) return [[{ id: id(20), created_at: "2026-10-24 10:00:00" }]];
      return [{ affectedRows: 1 }];
    },
  };
  const service = createFeedbackService({ db: { async getConnection() { return connection; } }, afterCommit(result) { assert(committed > 0); delivery.push(result); } });
  return { service, calls, notifications, delivery, get state() { return { released, rolledBack, committed }; } };
}

test("students fail closed for every read and write before a database connection is acquired", async () => {
  const f = fixture(), user = { role: "student", id: id(2) };
  for (const action of [
    () => f.service.list(user), () => f.service.detail(user, id(99)), () => f.service.interns(user),
    () => f.service.create(user, input()), () => f.service.reply(user, id(99), { body: "x" }),
    () => f.service.status(user, id(99), "resolved"), () => f.service.attachment(user, id(99), id(7)),
    () => f.service.replies(user, id(99), id(20)),
  ]) await assert.rejects(action, { status: 403 });
  assert.equal(f.calls.length, 0);
});
test("validate categories, title/body, duplicate IDs, limits, and hidden-field forged tags", () => {
  for (const bad of [
    { ...input(), subject: "  " }, { ...input(), description: " " }, { ...input(), category: "wrong" },
    { ...input(), internshipIds: "not-json" }, { ...input(), internshipIds: [id(2)] },
    { ...input([id(2)]), internshipIds: ["/arbitrary"] },
  ]) assert.throws(() => validatePost(bad), { status: 400 });
  assert.deepEqual(validatePost(input([id(2), id(2)])).ids, [id(2)]);
});
test("multi-department post captures snapshots and notifies each recipient once", async () => {
  const tags = [2,3,4].map((n, index) => ({ id: id(n), student_id: id(n+10), student_name: "Intern " + n, department_id: index < 2 ? 1 : 2, department_code: index < 2 ? "CCS" : "CITHM", department_name: "Department", company_name: "Company" }));
  const f = fixture({ tags, recipients: [{ id: "head-ccs" }, { id: "head-cithm" }, { id: "head-ccs" }, { id: "admin" }, { id: employer.id }] });
  const result = await f.service.create(employer, input(tags.map(t => t.id)));
  assert.equal(f.notifications.length, 3);
  assert.deepEqual(f.notifications.map(n => n[0]).sort(), ["admin","head-ccs","head-cithm"]);
  assert(f.notifications.every(n => n[2] === "feedback_mentioned" && n[5] === result.id));
  assert.equal(f.calls.filter(c => c.sql.includes("INSERT INTO feedback_mentions")).length, 3);
  assert.deepEqual(f.calls.filter(c => c.sql.includes("INSERT INTO feedback_mentions")).map(c => c.values[4]), [1,1,2]);
  assert.equal(f.delivery.length, 1); assert.equal(f.state.committed, 1); assert.equal(f.state.released, 1);
});
test("untagged platform feedback sends only database-selected admin recipients", async () => {
  const f = fixture({ recipients: [{ id: "admin" }] });
  await f.service.create(employer, input());
  assert(!f.calls.some(c => c.sql.includes("FROM internship_records")));
  assert.equal(f.notifications.length, 1);
  const query = f.calls.find(c => c.sql.includes("SELECT DISTINCT u.id"));
  assert.match(query.sql, /r.role = 'admin'/); assert.match(query.sql, /fm.post_id = p.id/); assert.deepEqual(query.values, [f.delivery[0].id, employer.id]);
});
test("forged or reassigned internship tags roll back without posting or notifying", async () => {
  const f = fixture();
  await assert.rejects(() => f.service.create(employer, input([id(22)])), { status: 403 });
  assert(!f.calls.some(c => c.sql.includes("INSERT INTO feedback_posts")));
  assert.equal(f.notifications.length, 0); assert.equal(f.state.rolledBack, 1); assert.equal(f.state.released, 1);
});
test("employer and department scopes use stored post membership, never client department claims", () => {
  assert.deepEqual(feedbackScope(employer).params, [employer.id]);
  assert.match(feedbackScope(employer).sql, /p.author_id = \?/);
  const head = feedbackScope({ id: "head", role: "department_head", department_id: "forged" });
  assert.match(head.sql, /feedback_mentions/); assert.match(head.sql, /dh.user_id = \?/);
  assert(!head.sql.includes("student_academic_info")); assert.deepEqual(head.params, ["head"]);
});
test("unauthorized details, replies, status and attachment access return 404, without reading private child rows", async () => {
  for (const role of ["employer", "department_head"]) {
    const f = fixture({ access: false }), user = { id: "outsider", role };
    for (const run of [
      () => f.service.detail(user, id(99)), () => f.service.reply(user, id(99), { body: "Hello" }),
      () => f.service.attachment(user, id(99), id(7)), () => f.service.replies(user, id(99), id(20)),
    ]) await assert.rejects(run, { status: 404 });
    if (role === "department_head") await assert.rejects(() => f.service.status(user, id(99), "resolved"), { status: 404 });
    assert(!f.calls.some(c => c.sql.includes("FROM feedback_replies") || c.sql.includes("FROM feedback_attachments")));
  }
});
test("employer cannot update status or create/read internal notes", async () => {
  const f = fixture();
  await assert.rejects(() => f.service.status(employer, id(99), "resolved"), { status: 403 });
  await assert.rejects(() => f.service.reply(employer, id(99), { body: "Secret", isInternal: true }), { status: 403 });
  const detail = await f.service.detail(employer, id(99));
  assert(detail.replies.every(r => !r.is_internal));
  assert.match(f.calls.find(c => c.sql.includes("SELECT fr.id")).sql, /fr.is_internal = 0/);
});
test("internal notes notify staff only and do not affect employer feed ordering", async () => {
  const f = fixture({ role: "department_head", recipients: [{ id: "head" }, { id: "admin" }] });
  await f.service.reply({ id: "head", role: "department_head" }, id(99), { body: "Internal detail", isInternal: true });
  const recipientsQuery = f.calls.find(c => c.sql.includes("SELECT DISTINCT u.id"));
  assert(!recipientsQuery.sql.includes("OR u.id = ?"));
  assert(!f.calls.some(c => c.sql.includes("updated_at = CURRENT_TIMESTAMP")));
  assert.deepEqual(f.notifications.map(n => n[0]), ["admin"]);
});
test("notification failure rolls back and commit uncertainty preserves upload ownership", async () => {
  const f = fixture({ recipients: [{ id: "admin" }], insertError: true });
  await assert.rejects(() => f.service.create(employer, input()));
  assert.equal(f.state.rolledBack, 1); assert.equal(f.delivery.length, 0);
  const uncertain = fixture({ commitError: true });
  await assert.rejects(() => uncertain.service.create(employer, input()), error => error.commitUncertain === true);
  assert.equal(uncertain.delivery.length, 0);
});
test("list scopes precede pagination and combine search/category/status safely", async () => {
  const f = fixture();
  await f.service.list(employer, { page: 2, category: "technical_issue", status: "open", search: "' OR 1=1" });
  const list = f.calls.find(c => c.sql.includes("ORDER BY p.updated_at"));
  assert.match(list.sql, /p.author_id = \?/); assert.match(list.sql, /LIMIT 15 OFFSET 15/);
  assert(!list.sql.includes("' OR 1=1")); assert(list.values.includes("%' OR 1=1%"));
});
test("attachments validate both declared type and actual bytes", () => {
  assert.equal(attachmentType({ buffer: Buffer.from("%PDF-1.7 test"), mimetype: "application/pdf" }), "pdf");
  assert.throws(() => attachmentType({ buffer: Buffer.from("html"), mimetype: "application/pdf" }), { status: 400 });
  assert.throws(() => attachmentType({ buffer: Buffer.from("<svg>"), mimetype: "image/svg+xml" }), { status: 400 });
  assert.deepEqual(uniqueRecipients([{ id: "a" }, { id: "a" }, { id: "self" }], "self"), ["a"]);
});

test("staff status changes notify participants after commit and validate allowed values", async () => {
  const f = fixture({ role: "department_head", recipients: [{ id: "head" }, { id: "admin" }, { id: employer.id }] });
  const head = { role: "department_head", id: "head" };
  await assert.rejects(() => f.service.status(head, id(99), "unknown"), { status: 400 });
  await f.service.status(head, id(99), "in_review");
  assert(f.calls.some(c => c.sql.includes("UPDATE feedback_posts SET status") && c.values[0] === "in_review"));
  assert.equal(f.notifications.length, 2); assert.equal(f.delivery.length, 1);
  assert(f.notifications.every(n => n[2] === "feedback_status"));
});
test("resolved discussions reject replies until school staff reopen them", async () => {
  const f = fixture({ status: "resolved" });
  await assert.rejects(() => f.service.reply(employer, id(99), { body: "New reply" }), { status: 409 });
  assert(!f.calls.some(c => c.sql.includes("INSERT INTO feedback_replies")));
  assert.equal(f.state.rolledBack, 1);
});

async function audienceDatabase() {
  const { DatabaseSync } = await import("node:sqlite");
  const sql = new DatabaseSync(":memory:");
  sql.function("CONCAT_WS", { varargs: true }, (separator, ...parts) => parts.filter(part => part != null).join(separator));
  sql.exec(`
    CREATE TABLE user_profiles (user_id TEXT, first_name TEXT, last_name TEXT);
    CREATE TABLE roles (id INTEGER PRIMARY KEY, role TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, role_id INTEGER, deleted_at TEXT);
    CREATE TABLE dept_heads_background_info (user_id TEXT, department_id INTEGER);
    CREATE TABLE feedback_posts (id TEXT PRIMARY KEY, author_id TEXT, category TEXT, subject TEXT, description TEXT, status TEXT DEFAULT 'open', created_at TEXT, updated_at TEXT, public_reply_version INTEGER DEFAULT 0, staff_reply_version INTEGER DEFAULT 0);
    CREATE TABLE feedback_mentions (post_id TEXT, department_id INTEGER);
    CREATE TABLE notifications (user_id TEXT, sender_id TEXT, type TEXT, title TEXT, message TEXT, link_uuid TEXT);
    INSERT INTO roles VALUES (1,'employer'),(2,'department_head'),(3,'admin'),(4,'student');
    INSERT INTO users VALUES ('owner',1,NULL),('other-employer',1,NULL),('ccs-head',2,NULL),
      ('cithm-head',2,NULL),('registrar-head',2,NULL),('removed-head',2,'2026-10-24'),('admin',3,NULL),('student',4,NULL);
    INSERT INTO dept_heads_background_info VALUES ('ccs-head',1),('cithm-head',2),('registrar-head',3),('removed-head',1);
    INSERT INTO feedback_posts (id,author_id,category) VALUES
      ('general','owner','general_feedback'),('technical','owner','technical_issue'),
      ('platform','owner','platform_feedback'),('internship','owner','internship_feedback'),
      ('untagged','owner','internship_feedback');
    INSERT INTO feedback_mentions VALUES ('internship',1),('technical',1),('platform',2);
  `);
  return sql;
}

test("category access works in real SQL for all heads and keeps technical issues private even with legacy tags", async () => {
  const sql = await audienceDatabase();
  try {
    for (const [role, userId, expected] of [
      ["department_head","ccs-head",["general","internship"]],
      ["department_head","cithm-head",["general"]],
      ["department_head","registrar-head",["general"]],
      ["employer","owner",["general","internship","platform","technical","untagged"]],
      ["employer","other-employer",[]],
      ["admin","admin",["general","internship","platform","technical","untagged"]],
    ]) {
      const scope = feedbackScope({ role, id: userId, department_id: 999 });
      const result = sql.prepare("SELECT p.id FROM feedback_posts p WHERE " + scope.sql + " ORDER BY p.id").all(...scope.params);
      assert.deepEqual(result.map(row => row.id), expected, userId);
      if (role === "department_head") {
        const filtered = sql.prepare("SELECT p.id FROM feedback_posts p WHERE " + scope.sql + " AND p.category = ?").all(...scope.params,"technical_issue");
        assert.equal(filtered.length, 0, "category filters cannot escape the department scope");
      }
    }
  } finally { sql.close(); }
});

test("general notifications reach all active department heads; technical and platform notifications reach admin only", async () => {
  const sql = await audienceDatabase(), deliveries = [];
  const connection = {
    async beginTransaction() { sql.exec("BEGIN"); }, async commit() { sql.exec("COMMIT"); },
    async rollback() { sql.exec("ROLLBACK"); }, release() {},
    async execute(query, values = []) {
      const statement = sql.prepare(query);
      return query.trimStart().startsWith("SELECT") ? [statement.all(...values)] : [statement.run(...values)];
    },
  };
  const service = createFeedbackService({ db: { async getConnection() { return connection; } }, afterCommit(result) { deliveries.push(result); } });
  try {
    for (const [category, expected] of [
      ["general_feedback",["admin","ccs-head","cithm-head","registrar-head"]],
      ["technical_issue",["admin"]],
      ["platform_feedback",["admin"]],
    ]) {
      const result = await service.create({ id: "owner", role: "employer" }, { ...input(), category });
      const rows = sql.prepare("SELECT user_id FROM notifications WHERE link_uuid = ? ORDER BY user_id").all(result.id);
      assert.deepEqual(rows.map(row => row.user_id), expected, category);
      assert.equal(deliveries.at(-1).id, result.id);
    }
  } finally { sql.close(); }
});

test("create returns the saved authorized detail only after commit, with attachment metadata but no storage paths", async () => {
  const tag = { id: id(2), student_id: id(12), student_name: "Ana", department_id: 1, department_code: "CCS", department_name: "Computing", company_name: "Company" };
  const f = fixture({ tags: [tag] });
  const result = await f.service.create(employer, input([tag.id]), [{ id: id(5), path: "feedback/private/secret.pdf", filename: "proof.pdf", mime: "application/pdf", size: 50 }]);
  assert.equal(result.detail.post.id, result.id);
  assert.equal(result.detail.post.author_id, employer.id);
  assert.equal(result.detail.post.subject, "Hello", "the database view, not a local draft, populates the cache");
  assert.equal(result.detail.mentions[0].internship_id, tag.id);
  assert.equal(result.detail.attachments[0].filename, "proof.pdf");
  assert.equal(result.detail.attachments[0].mime_type, "application/pdf");
  assert.deepEqual(result.detail.replies, []);
  assert.equal(result.detail.moreReplies, false);
  assert(!JSON.stringify(result.detail).includes("secret.pdf"));
  assert.equal(f.state.committed, 1);
});
