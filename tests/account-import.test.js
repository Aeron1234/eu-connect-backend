import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import cache from "../config/cache/cache.js";
import { createUser } from "../features/accounts/controllers/accountControllers.js";
import { parseAccountCsv as parseCsv, previewAccounts, importAccounts, previewAccountImport } from "../features/accounts/accountImport.js";
import { studentUsername, validateStudentIdentity } from "../features/accounts/studentIdentity.mjs";
import { drainAccountInvitations } from "../features/accounts/accountInvitationQueue.js";

const original = { getConnection: db.getConnection, fetch: global.fetch };
after(async () => { db.getConnection = original.getConnection; global.fetch = original.fetch; cache.close(); await db.end(); });
const parseAccountCsv = csv => parseCsv(csv, "student");
const previewStudents = csv => previewAccounts(csv, "student");
const importStudentAccounts = (request, res) => importAccounts({ ...request, body: { ...request.body, role: "student" } }, res);
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

function fixture({ occupied = [], existingEmail = false, legacyId = false, failInsert = false, role = "student" } = {}) {
  const calls = [];
  let committed = 0, rolledBack = 0;
  const connection = {
    async beginTransaction() {}, async commit() { committed++; }, async rollback() { rolledBack++; }, release() {},
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (sql.startsWith("SELECT id, short_name FROM courses")) return [[{ id: 7, short_name: "BSCS" }]];
      if (sql.includes("FROM roles")) return [[{ id: 1, role }]];
      if (sql.includes("FROM departments")) return [[{ id: 6, code: "CCS" }]];
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



test("CSV casing is normalized before preview, username generation and persisted account creation", async () => {
  const input = header + "\n  jOHN   cARLO ,a.,dELA cRUZ,john@example.test,A12-0000,bscs, MALE ";
  fixture();
  const rows = await previewStudents(input);
  assert.equal(rows[0].error, null);
  assert.equal(rows[0].data.first_name, "John Carlo");
  assert.equal(rows[0].data.last_name, "Dela Cruz");
  assert.equal(rows[0].data.middle_initial, "A.");
  assert.equal(rows[0].data.gender, "male");
  assert.equal(rows[0].username, "DelaCruz.JohnCarlo.A12-0000");
  const f = fixture();
  const result = response(); await importStudentAccounts(req({ csv: input }), result);
  assert.equal(result.body.results[0].status, "created");
  const stored = f.calls.find(call => call.sql.startsWith("INSERT INTO user_profiles"));
  assert.deepEqual(stored.params.slice(1), ["John Carlo", "A", "Dela Cruz", "male"]);
  const invalid = await previewStudents(input.replace(" MALE ", "unknown"));
  assert.match(invalid[0].error, /Gender/);
});

test("CSV title casing retains accented letters, apostrophes and hyphens", () => {
  const row = parseAccountCsv(header + "\njos\u00e9-mARIE,,o'NEIL,j@example.test,,BSCS,FeMaLe")[0];
  assert.equal(row.data.first_name, "Jos\u00e9-Marie");
  assert.equal(row.data.last_name, "O'Neil");
  assert.equal(row.data.gender, "female");
});

test("CSV endpoints require a supported role and reject another role's columns", async () => {
  for (const role of [undefined, "", "__proto__", ["student"], "employer"]) {
    const request = req({ csv, role });
    for (const handler of [previewAccountImport, importAccounts]) {
      const res = response();
      await handler(request, res);
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /role/i);
    }
  }
});

test("bulk creation uses the selected role and validates its username and department fields", async () => {
  const common = "first_name,last_name,email,username";
  for (const role of ["employer", "department_head", "admin"]) {
    const head = role === "department_head";
    const contents = common + (head ? ",department_code" : "") +
      "\nJOHN,perez,john@example.test,John.Perez" + (head ? ",ccs" : "");
    const f = fixture({ role });
    const res = response();
    await importAccounts(req({ role, csv: contents }), res);
    assert.equal(res.body.results[0].status, "created");
    assert.equal(res.body.results[0].username, "John.Perez");
    assert.equal(f.calls.find(call => call.sql === "SELECT id FROM roles WHERE role = ?").params[0], role);
    assert.equal(f.calls.some(call => call.sql.includes("INSERT INTO employer_background_info")), role === "employer");
    if (head) {
      assert.equal(f.calls.find(call => call.sql.includes("INSERT INTO dept_heads_background_info")).params[1], 6);
      assert.match((await previewAccounts(contents.replace(",ccs", ",unknown"), role))[0].error, /Department code/);
    }
    assert.match((await previewAccounts(contents, role))[0].error, /Username is already taken/);
  }
});
