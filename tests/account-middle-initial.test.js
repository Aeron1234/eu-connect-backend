import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";
import { createUser } from "../features/accounts/controllers/accountControllers.js";

const originalGetConnection = db.getConnection;
const originalFetch = global.fetch;
// Account creation also sends an invitation; keep this profile-field regression
// isolated from live email services and any credentials in the local .env.
global.fetch = async () => new Response("OK");
after(async () => {
  db.getConnection = originalGetConnection;
  global.fetch = originalFetch;
  await db.end();
});

function response() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("admin account creation saves an optional uppercase middle initial", async () => {
  const calls = [];
  db.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM roles")) return [[{ role: "employer" }]];
      if (sql.startsWith("SELECT id FROM users")) return [[]];
      return [{ affectedRows: 1 }];
    },
  });

  const req = {
    verifiedUser: { id: "admin-1", role: "admin" },
    body: {
      username: "jane.cruz",
      email: "jane@example.test",
      password: "temporary123",
      role: "3",
      first_name: "Jane",
      middle_initial: "a.",
      last_name: "Cruz",
    },
  };
  const res = response();
  await createUser(req, res);
  assert.equal(res.statusCode, 201);
  const profileInsert = calls.find(({ sql }) =>
    sql.startsWith("INSERT INTO user_profiles"),
  );
  assert.ok(profileInsert);
  assert.equal(profileInsert.params[2], "A");

  const withoutInitial = response();
  await createUser(
    { ...req, body: { ...req.body, middle_initial: "" } },
    withoutInitial,
  );
  assert.equal(withoutInitial.statusCode, 201);
  const profileInserts = calls.filter(({ sql }) =>
    sql.startsWith("INSERT INTO user_profiles"),
  );
  assert.equal(profileInserts[1].params[2], null);
});

test("account creation rejects a middle name in the initial field", async () => {
  db.getConnection = async () => ({ release() {} });
  const res = response();
  await createUser(
    {
      verifiedUser: { id: "admin-1", role: "admin" },
      body: {
        username: "invalid",
        email: "jane@example.test",
        password: "temporary123",
        role: "3",
        first_name: "Jane",
        middle_initial: "Anne",
        last_name: "Cruz",
      },
    },
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Middle initial/);
});
