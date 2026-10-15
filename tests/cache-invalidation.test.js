import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import cache from "../config/cache/cache.js";
import { db } from "../config/db.js";
import { AVAILABLE_AVATARS } from "../config/avatars.js";
import { updateUserAvatar, deleteUserAvatar, deactivateAccount, reactivateAccount, getCreateAccountFormData } from "../features/accounts/controllers/accountControllers.js";
import { addDepartment, addCourse, activateCourse, deactivateCourse, activateDepartment, deactivateDepartment } from "../features/departments-and-courses/controllers/departmentsAndCoursesControllers.js";

const originalGetConnection = db.getConnection;
const profile = "/eu-connect/api/account/user";
const accounts = "/eu-connect/api/accounts";
const form = "/eu-connect/api/create-account-form-data";

function seed() {
  for (const [key, userId, path] of [["target", "alice", profile], ["other", "bob", profile], ["list1", "admin1", accounts], ["list2", "admin2", accounts], ["form", "admin1", form]]) {
    cache.set(key, { userId, path, body: {} });
  }
}
function response() {
  return { locals: {}, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function mockConnection({ failCommit = false, rows = [{ id: 1, is_active: 0 }] } = {}) {
  const connection = {
    async beginTransaction() {}, async rollback() {}, release() {},
    async commit() {
      assert.ok(cache.has("form"), "invalidation must follow commit");
      if (failCommit) throw new Error("simulated rollback");
    },
    async execute(sql) {
      if (sql.includes("WHERE code =") || sql.includes("WHERE short_name =")) return [[]];
      if (sql.trim().startsWith("SELECT")) return [rows];
      return [{ affectedRows: 1, insertId: 1 }];
    },
  };
  db.getConnection = async () => connection;
  return connection;
}

beforeEach(() => { cache.flushAll(); seed(); });
after(async () => { db.getConnection = originalGetConnection; cache.close(); await db.end(); });

test("avatar mutations invalidate both the profile and every admin's list", async () => {
  for (const handler of [updateUserAvatar, deleteUserAvatar]) {
    seed(); mockConnection();
    cache.set("searched-avatar",{path:"/eu-connect/api/searched-user/alice",userId:"staff",body:{}});
    const res = response();
    await handler({ verifiedUser: { id: "alice" }, body: { avatar: AVAILABLE_AVATARS[0] } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(cache.has("target"), false);
    assert.equal(cache.has("searched-avatar"), false);
    assert.equal(cache.has("list1"), false);
    assert.equal(cache.has("list2"), false);
    assert.equal(cache.has("other"), true);
  }
});

test("account activation changes invalidate the target and account lists", async () => {
  for (const handler of [deactivateAccount, reactivateAccount]) {
    seed(); mockConnection();
    const res = response();
    cache.set("document-account",{path:"/eu-connect/api/searched-user/files/alice",userId:"staff",body:[]});
    await handler({ verifiedUser: { id: "admin1", role: "admin" }, params: { accountId: "alice" } }, res);
    assert.equal(cache.has("document-account"),false);
    assert.equal(res.statusCode, 200);
    assert.equal(cache.has("target"), false);
    assert.equal(cache.has("list1"), false);
    assert.equal(cache.has("other"), true);
  }
});

test("all course/department write paths invalidate account form choices", async () => {
  for (const handler of [addDepartment, addCourse, activateCourse, deactivateCourse, activateDepartment, deactivateDepartment]) {
    seed();
    mockConnection({ rows: [{ id: 1, is_active: [deactivateCourse, deactivateDepartment].includes(handler) ? 1 : 0 }] });
    const res = response();
    await handler({ params: { id: 1 }, body: { name: "IT", code: "IT", course_name: "Computing", short_name: "CS", department_id: 1 } }, res);
    assert.ok(res.statusCode < 300);
    assert.equal(cache.has("form"), false);
    assert.equal(cache.has("other"), true);
  }
});

test("failed commits do not invalidate cached data", async () => {
  mockConnection({ failCommit: true });
  const log = console.error;
  try {
    console.error = () => {};
    const res = response();
    await addDepartment({ body: { name: "IT", code: "IT" } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(cache.has("form"), true);
  } finally { console.error = log; }
});

test("partial account form lookup failures opt out of caching", async () => {
  const connection = mockConnection();
  connection.execute = async () => { throw new Error("lookup unavailable"); };
  const log = console.error;
  try {
    console.error = () => {};
    const res = response();
    await getCreateAccountFormData({}, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.locals.skipCache, true);
  } finally { console.error = log; }
});
