import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import cache from "../config/cache/cache.js";
import { db } from "../config/db.js";

process.env.ACCESS_TOKEN_SECRET = "student-delete-test";
process.env.REFRESH_TOKEN_SECRET = "student-delete-refresh";
process.env.TEMP_PASSWORD_SECRET = "student-delete-temp";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_KEY = "no-network";

const { default: routes } = await import("../features/internship-records/routes/internshipRecordRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");

const originalGetConnection = db.getConnection;
const originalExecute = db.execute;
let record;
let statements;
let commits;
let rollbacks;
let releases;
let failUpdate;

beforeEach(() => {
  cache.flushAll();
  record = {
    id: "record-1",
    user_id: "student-1",
    status: "pending",
    deleted_at: null,
    company_name: "Example Company",
  };
  statements = [];
  commits = 0;
  rollbacks = 0;
  releases = 0;
  failUpdate = false;
  db.execute = async (sql) => {
    statements.push(sql);
    return [[]];
  };
  db.getConnection = async () => ({
    async beginTransaction() {},
    async commit() { commits += 1; },
    async rollback() { rollbacks += 1; },
    release() { releases += 1; },
    async execute(sql) {
      statements.push(sql);
      if (sql.includes("FROM internship_records WHERE id = ? FOR UPDATE")) {
        return [record ? [{ ...record }] : []];
      }
      if (sql.includes("UPDATE internship_records SET deleted_at")) {
        if (failUpdate) throw new Error("database unavailable");
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SELECT first_name, last_name FROM user_profiles")) {
        return [[{ first_name: "Test", last_name: "Student" }]];
      }
      return [{ affectedRows: 1 }];
    },
  });
});

after(async () => {
  db.getConnection = originalGetConnection;
  db.execute = originalExecute;
  cache.close();
  await db.end();
});

async function client(t) {
  const app = express();
  app.use("/eu-connect/api", routes);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return (path, role = "student", userId = "student-1", method = "DELETE") =>
    fetch(`http://127.0.0.1:${server.address().port}/eu-connect/api${path}`, {
      method,
      headers: userId ? {
        Authorization: `Bearer ${signAccessToken({ id: userId, role })}`,
      } : {},
    });
}

function seedCache() {
  for (const path of [
    "/eu-connect/api/internships/all",
    "/eu-connect/api/internships/my-past-internships",
    "/eu-connect/api/internship-records/department",
    "/eu-connect/api/notifications",
    "/eu-connect/api/activity-logs",
  ]) {
    cache.set(path, { path, userId: "student-1", body: [] });
  }
  const unrelated = "/eu-connect/api/departments";
  cache.set(unrelated, { path: unrelated, userId: "student-1", body: [] });
}

test("students can soft-delete their own pending and rejected records after commit", async (t) => {
  const request = await client(t);
  for (const status of ["pending", "rejected"]) {
    record.status = status;
    seedCache();
    const response = await request("/internship-records/mine/record-1");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
    assert.equal(commits, status === "pending" ? 1 : 2);
    assert.equal(rollbacks, 0);
    assert.ok(statements.some((sql) => sql.includes("status IN ('pending', 'rejected')")));
    assert.ok(statements.some((sql) => sql.includes("DELETE FROM notifications")));
    assert.ok(statements.some((sql) => sql.includes("INSERT INTO activity_logs")));
    assert.ok(cache.has("/eu-connect/api/departments"));
    assert.equal(cache.has("/eu-connect/api/internships/all"), false);
    assert.equal(cache.has("/eu-connect/api/notifications"), false);
  }
  assert.equal(releases, 2);
});

test("authentication, ownership, status and existing deletion are enforced", async (t) => {
  const request = await client(t);
  seedCache();
  assert.equal((await request("/internship-records/mine/record-1", "student", null)).status, 401);
  assert.equal((await request("/internship-records/mine/record-1", "admin")).status, 403);
  record.user_id = "someone-else";
  assert.equal((await request("/internship-records/mine/record-1")).status, 403);
  record.user_id = "student-1";
  for (const status of ["ongoing", "finished"]) {
    record.status = status;
    assert.equal((await request("/internship-records/mine/record-1")).status, 409);
  }
  record.status = "pending";
  record.deleted_at = "2026-10-01";
  assert.equal((await request("/internship-records/mine/record-1")).status, 404);
  record = null;
  assert.equal((await request("/internship-records/mine/record-1")).status, 404);
  assert.equal(commits, 0);
  assert.equal(rollbacks, 5);
  assert.ok(cache.has("/eu-connect/api/internships/all"));
});

test("a failed write rolls back and leaves caches intact", async (t) => {
  const request = await client(t);
  seedCache();
  failUpdate = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal((await request("/internship-records/mine/record-1")).status, 500);
  } finally {
    console.error = originalError;
  }
  assert.equal(commits, 0);
  assert.equal(rollbacks, 1);
  assert.equal(releases, 1);
  assert.ok(cache.has("/eu-connect/api/internships/all"));
  assert.ok(!statements.some((sql) => sql.includes("DELETE FROM notifications")));
});

test("student record reads exclude soft-deleted rows", async (t) => {
  const request = await client(t);
  assert.equal((await request("/internships/all", "student", "student-1", "GET")).status, 200);
  assert.equal((await request("/internships/active", "student", "student-1", "GET")).status, 200);
  assert.equal((await request("/internships/my-past-internships", "student", "student-1", "GET")).status, 200);
  assert.equal(statements.filter((sql) => sql.includes("deleted_at IS NULL")).length, 3);
});
