import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import cache from "../config/cache/cache.js";
import { createUser } from "../features/accounts/controllers/accountControllers.js";
import { parseAccountCsv, previewStudents, importStudentAccounts } from "../features/accounts/accountImport.js";
import { studentUsername, validateStudentIdentity } from "../features/accounts/studentIdentity.mjs";
import { drainAccountInvitations } from "../features/accounts/accountInvitationQueue.js";

const original = { getConnection: db.getConnection, fetch: global.fetch };
after(async () => { db.getConnection = original.getConnection; global.fetch = original.fetch; cache.close(); await db.end(); });
const header = "first_name,middle_initial,last_name,email,school_id,course_code,gender";
const csv = header + "\r\nJohn Carlo,,Dela Cruz,john@example.test,A24-0483,BSCS,male";
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("names and optional IDs produce stable usernames, preserve Unicode letters and enforce storage limits", () => {
  assert.equal(studentUsername("John Carlo", "Dela Cruz", "a24-0483"), "DelaCruz.JohnCarlo.A24-0483");
  assert.equal(studentUsername("José", "Dela Cruz"), "DelaCruz.José");
  assert.throws(() => validateStudentIdentity({ first_name: "J", last_name: "D", school_id: "A/24" }), /school ID/i);
  assert.throws(() => validateStudentIdentity({ first_name: "J".repeat(50), last_name: "D" }), /50/);
});

test("CSV accepts BOM, quoted commas, escaped quotes and optional headers; rejects malformed and oversized files", () => {
  const rows = parseAccountCsv("\uFEFF" + header + '\r\n"John, Carlo",,"Dela ""Cruz""",john@example.test,,BSCS,male\r\n');
  assert.equal(rows[0].data.first_name, "John, Carlo");
  assert.equal(rows[0].data.last_name, 'Dela "Cruz"');
  assert.throws(() => parseAccountCsv(header + '\n"broken'), /unclosed/);
  assert.throws(() => parseAccountCsv("first_name,first_name\nJuan,Juan"), /template/);
  assert.throws(() => parseAccountCsv(header + "\n" + Array(101).fill("J,,D,j@example.test,,BSCS,male").join("\n")), /100/);
  assert.throws(() => parseAccountCsv("x".repeat(256 * 1024 + 1)), /256/);
  assert.equal(parseAccountCsv(header + "\nJ,D")[0].error, "Column count does not match the header.");
});

function fixture({ occupied = [], existingEmail = false, legacyId = false, failInsert = false } = {}) {
  const calls = [];
  let committed = 0, rolledBack = 0;
  const connection = {
    async beginTransaction() {}, async commit() { committed++; }, async rollback() { rolledBack++; }, release() {},
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (sql.startsWith("SELECT id, short_name FROM courses")) return [[{ id: 7, short_name: "BSCS" }]];
      if (sql.includes("FROM roles")) return [[{ id: 1, role: "student" }]];
      if (sql.includes("SELECT department_id FROM courses")) return [[{ department_id: 2 }]];
      if (sql.includes("FROM users WHERE username")) return [occupied.includes(params[0]) ? [{ id: "existing" }] : []];
      if (sql.includes("FROM users WHERE email")) return [existingEmail ? [{ id: "existing" }] : []];
      if (sql.includes("FROM user_profiles")) return [[]];
      if (sql.includes("FROM student_academic_info")) return [legacyId ? [{ user_id: "old" }] : []];
      if (sql.startsWith("INSERT INTO users")) {
        if (failInsert) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
        occupied.push(params[2]);
      }
      return [{ affectedRows: 1 }];
    },
  };
  db.getConnection = async () => connection;
  return { calls, get committed() { return committed; }, get rolledBack() { return rolledBack; } };
}
const student = { role: "1", first_name: "John Carlo", last_name: "Dela Cruz", email: "john@example.test", course: "7", gender: "male", school_id: "a24-0483", username: "forged" };
const req = body => ({ body, verifiedUser: { id: "admin", role: "admin" }, queueAccountInvitation: true });

test("manual and import creation use the server username and commit a durable invitation with the account", async () => {
  const f = fixture();
  const res = response();
  await createUser(req(student), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.username, "DelaCruz.JohnCarlo.A24-0483");
  assert.equal(res.body.invitation_queued, true);
  assert.equal(f.committed, 1);
  assert(f.calls.some(c => c.sql.includes("INSERT INTO account_invitation_jobs")));
  assert.deepEqual(f.calls.find(c => c.sql.includes("UPDATE user_profiles SET school_id")).params.slice(0, 1), ["A24-0483"]);
  assert(!f.calls.some(c => c.sql.includes("password_setup_token_hash")));
});

test("missing IDs allocate a suffix against existing accounts; old school numbers and insert races reject creation", async () => {
  const f = fixture({ occupied: ["DelaCruz.JohnCarlo", "DelaCruz.JohnCarlo.2"] });
  const res = response(); await createUser(req({ ...student, school_id: "" }), res);
  assert.equal(res.body.username, "DelaCruz.JohnCarlo.3");
  assert.equal(f.committed, 1);
  for (const options of [{ legacyId: true }, { failInsert: true }]) {
    const current = fixture(options), denied = response();
    await createUser(req(student), denied);
    assert.equal(denied.statusCode, 409);
    assert.equal(current.committed, 0);
    assert.equal(current.rolledBack, 1);
  }
});

test("preview flags existing emails and duplicate file identities, handles missing IDs and ambiguous course codes", async () => {
  fixture();
  const rows = await previewStudents(csv + "\nJane,,Doe,john@example.test,A24-0484,BSCS,female");
  assert.equal(rows[0].username, "DelaCruz.JohnCarlo.A24-0483");
  assert.match(rows[1].error, /Duplicate email/);
  fixture({ existingEmail: true });
  assert.match((await previewStudents(csv))[0].error, /already belongs/);
  fixture({ legacyId: true });
  assert.match((await previewStudents(csv))[0].error, /School ID/);
  fixture();
  const noIds = await previewStudents(header + "\nJ,,D,a@example.test,,BSCS,male\nJ,,D,b@example.test,,BSCS,male");
  assert.deepEqual(noIds.map(r => r.username), ["D.J", "D.J.2"]);
  assert.match((await previewStudents(csv.replace(",BSCS,", ",UNKNOWN,")))[0].error, /Course code/);
});

test("import validates again, returns partial results and safely skips accounts on retry", async () => {
  fixture();
  const res = response();
  await importStudentAccounts(req({ csv: csv + "\nJane,,Doe,invalid,,BSCS,female" }), res);
  assert.deepEqual(res.body.results.map(r => r.status), ["created", "skipped"]);
  fixture({ existingEmail: true });
  const retry = response(); await importStudentAccounts(req({ csv }), retry);
  assert.equal(retry.body.results[0].status, "skipped");
});

test("queue prepares after claiming, sends after commit and records failed delivery without deleting the account", async () => {
  const calls = []; let committed = false;
  delete process.env.EMAILJS_SERVICE_ID; // No external mail calls in this test.
  db.getConnection = async () => ({
    async beginTransaction() {}, async rollback() {}, async commit() { committed = true; }, release() {},
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("SELECT user_id FROM account_invitation_jobs")) return [[{ user_id: "u1" }]];
      if (sql.includes("SELECT id, email")) return [[{ id: "u1", email: "john@example.test", username: "D.J", status: "active", password_setup_required: 1 }]];
      if (sql.includes("status = ?")) assert(committed);
      return [{ affectedRows: 1 }];
    },
  });
  await drainAccountInvitations();
  assert(calls.some(c => c.sql.includes("password_setup_token_hash")));
  assert(calls.some(c => c.sql.includes("status = ?") && c.params[0] === "failed"));
  assert(!calls.some(c => c.sql.includes("DELETE")));
});

