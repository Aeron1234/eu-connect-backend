import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { getAllAccounts, getUserProfile, updatePassword } from "../features/accounts/controllers/accountControllers.js";
import bcrypt from "bcryptjs";
import cache from "../config/cache/cache.js";

test("account count retains filters and row multiplicity without detail joins", async () => {
  const original = db.getConnection;
  const calls = [];
  const pageRows = [{ id: 17, role: "student", course_name: "BSIT" }];
  let released = 0;
  db.getConnection = async () => ({
    release() { released++; },
    async execute(sql, params) {
      calls.push({ sql, params });
      return calls.length === 1 ? [pageRows] : [[{ total: 43 }]];
    },
  });
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await getAllAccounts({ query: { filter: "student", search: "Ana", page: "3" } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      accounts: pageRows,
      totalPages: 3,
      totalRecords: 43,
      currentPage: 3,
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].params, ["student", "student", "%Ana%", "%Ana%", "%Ana%", 20, 40]);
    assert.deepEqual(calls[1].params, ["student", "student", "%Ana%", "%Ana%", "%Ana%"]);
    assert.match(calls[0].sql, /ORDER BY status ASC, last_name ASC/);
    for (const join of ["student_academic_info", "dept_heads_background_info", "employer_background_info"]) {
      assert.match(calls[1].sql, new RegExp(join));
    }
    for (const join of ["LEFT JOIN courses", "LEFT JOIN departments"]) {
      assert.doesNotMatch(calls[1].sql, new RegExp(join));
      assert.match(calls[0].sql, new RegExp(join));
    }
    assert.match(calls[1].sql, /role = \? OR status = \?/);
    assert.match(calls[1].sql, /first_name LIKE \? OR last_name LIKE \? OR email LIKE \?/);
    assert.equal(released, 1);
  } finally {
    db.getConnection = original;
  }
});

test("student profile selects only that user's latest academic record", async () => {
  const original = db.getConnection;
  const profile = {
    id: "student", email: "student@example.test", username: "student",
    role: "student", first_name: "Pat", last_name: "Lee", course: "BSIT",
    department_code: "CS", department_name: "Computing", student_number: "123",
    year_level: 4,
  };
  let sql;
  let params;
  let releases = 0;
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(statement, values) {
      sql = statement;
      params = values;
      return [[profile]];
    },
  });
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await getUserProfile({ verifiedUser: { id: "student", role: "student" } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, profile);
    assert.deepEqual(params, ["student"]);
    assert.match(sql, /sai\.id = \(\s*SELECT MAX\(sai_latest\.id\)/);
    assert.match(sql, /WHERE sai_latest\.user_id = u\.id/);
    assert.match(sql, /u\.password_changed_at/);
    assert.doesNotMatch(sql, /GROUP BY user_id/);
    assert.equal(releases, 1);
  } finally {
    db.getConnection = original;
  }
});

test("all account roles receive the password-change date in their profile", async () => {
  const original = db.getConnection;
  const queries = [];
  db.getConnection = async () => ({
    release() {},
    async execute(sql) {
      queries.push(sql);
      return [[{ id: "user", password_changed_at: null }]];
    },
  });
  try {
    for (const role of ["student", "employer", "department_head", "admin"]) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await getUserProfile({ verifiedUser: { id: "user", role } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.password_changed_at, null);
    }
    for (const sql of queries) assert.match(sql, /u\.password_changed_at/);
  } finally {
    db.getConnection = original;
  }
});

test("changing a password stores the change date and invalidates the cached profile", async () => {
  const original = db.getConnection;
  const oldHash = await bcrypt.hash("current-password", 4);
  const writes = [];
  let committed = false;
  db.getConnection = async () => ({
    release() {},
    async beginTransaction() {},
    async rollback() {},
    async commit() { committed = true; },
    async execute(sql, params) {
      if (sql.includes("SELECT password_hash")) return [[{ password_hash: oldHash }]];
      writes.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  });
  cache.set("account-profile-test", { userId: "user", path: "/eu-connect/api/account/user", body: {} });
  try {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await updatePassword({ verifiedUser: { id: "user" }, body: { currentPassword: "current-password", newPassword: "new-password" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(committed, true);
    assert.match(writes[0].sql, /password_changed_at = NOW\(\)/);
    assert.equal(cache.has("account-profile-test"), false);
  } finally {
    cache.del("account-profile-test");
    db.getConnection = original;
  }
});
