import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { db } from "../config/db.js";
import cache from "../config/cache/cache.js";
import { canHeadReadStudentRecords } from "../config/studentProfileAccess.js";
import { mountApiRoutes } from "../config/api.js";

process.env.ACCESS_TOKEN_SECRET = "department-profile-test";
process.env.REFRESH_TOKEN_SECRET = "department-profile-refresh";
process.env.TEMP_PASSWORD_SECRET = "department-profile-temp";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_KEY = "no-network";
process.env.CACHE_ENABLED = "true";
const { default: users } = await import("../features/users/routes/searchedUserRoutes.js");
const { default: weekly } = await import("../features/weekly-narratives/routes/weeklyNarrativeRoutes.js");
const { default: daily } = await import("../features/narratives/routes/narrativeRoutes.js");
const { default: evaluations } = await import("../features/evaluations/routes/studentEvaluationRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const original = db.getConnection;
let database, scopeError, scopeReads, privateReads;

beforeEach(() => {
  cache.flushAll(); scopeError = false; scopeReads = 0; privateReads = 0;
  database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE student_academic_info (id INTEGER PRIMARY KEY,user_id TEXT,department_id INTEGER); CREATE TABLE dept_heads_background_info (user_id TEXT,department_id INTEGER); INSERT INTO student_academic_info VALUES (1,'student',10); INSERT INTO dept_heads_background_info VALUES ('head',10);");
  db.getConnection = async () => ({
    release() {},
    async execute(sql, params) {
      if (sql.includes("FROM student_academic_info profile_student")) {
        scopeReads++;
        if (scopeError) throw Error("scope lookup failed");
        return [database.prepare(sql).all(...params).map(row => ({ ...row }))];
      }
      if (sql.includes("FROM users u")) {
        assert.match(sql, /MAX\(profile_latest.id\)/);
        return [[{ user_id: "student", role_name: "student", first_name: "Student", last_name: "Name", student_internship_id: "internship", student_internship_employer_id: "employer", student_department_name: "Department", total_hours: 200, hours_rendered: 30 }]];
      }
      privateReads++;
      throw Error("Private handler should not run without an authorized cache miss fixture");
    },
  });
});
after(async () => { db.getConnection = original; cache.close(); await db.end(); });
async function client(t) {
  const app = express(); app.use(express.json()); mountApiRoutes(app, [users, weekly, daily, evaluations]);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  t.after(() => database.close());
  return async (path, { method = "GET", role = "department_head", id = "head", prefix = "/api/v1" } = {}) => fetch(
    "http://127.0.0.1:" + server.address().port + prefix + path,
    { method, headers: { Authorization: "Bearer " + signAccessToken({ id, role, department_id: 777, department_code: "REG" }) } },
  );
}
function prime(path, role = "department_head", id = "head") {
  const key = JSON.stringify([id, role, undefined, 777, null, "REG", null, "/api/v1" + path]);
  cache.set(key, { userId: id, path: "/api/v1" + path, body: { marker: "private cached response" } }, 30);
}
const reads = [
  "/searched-user/dtrs/student",
  "/searched-user/files/student",
  "/searched-user/weekly-narratives/student",
];
const protectedRoutes = [
  ...reads.map(path => ["GET", path]),
  ["GET", "/searched-user/narratives/student"],
  ["GET", "/searched-user/set-dtr-location/student"],
  ["PUT", "/searched-user/set-dtr-location/student"],
  ["DELETE", "/searched-user/set-dtr-location/student"],
  ["GET", "/searched-user/files/file/student"],
  ["DELETE", "/searched-user/files/file/student"],
  ["GET", "/student-evaluations/student"],
  ["GET", "/student-past-evaluations/student"],
];

test("same-department private cache hits require fresh membership and transfers immediately deny them", async t => {
  const get = await client(t);
  for (const path of reads) {
    prime(path);
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.equal((await res.json()).marker, "private cached response");
  }
  assert.equal(scopeReads, reads.length); assert.equal(privateReads, 0);
  database.exec("INSERT INTO student_academic_info VALUES (2,'student',20)");
  for (const prefix of ["/api/v1", "/eu-connect/api"]) for (const path of reads) {
    const res = await get(path, { prefix });
    assert.equal(res.status, 403, prefix + path);
    assert.match((await res.json()).error, /your department/);
  }
  assert.equal(privateReads, 0);
});

test("another department cannot read or mutate any searched-student internship tool", async t => {
  const get = await client(t); database.exec("UPDATE dept_heads_background_info SET department_id=20");
  for (const [method, path] of protectedRoutes) {
    const res = await get(path, { method });
    assert.equal(res.status, 403, method + " " + path);
  }
  assert.equal(privateReads, 0);
});

test("basic profile stays visible with Info-only permission and ignores a previously cached capability", async t => {
  const get = await client(t); prime("/searched-user/student");
  let res = await get("/searched-user/student");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user.permissions.canViewStudentRecords, true);
  database.exec("UPDATE dept_heads_background_info SET department_id=20");
  res = await get("/searched-user/student");
  assert.equal(res.status, 200);
  const profile = (await res.json()).user;
  assert.equal(profile.header.first_name, "Student");
  assert.equal(profile.info.role, "student");
  assert.equal(profile.permissions.canViewStudentRecords, false);
  assert.equal(profile.info.internship_id, undefined);
  assert.equal(privateReads, 0);
});

test("missing department data denies private tools while Info remains available", async t => {
  const get = await client(t);
  for (const sql of ["DELETE FROM dept_heads_background_info", "DELETE FROM student_academic_info"]) {
    database.exec(sql);
    assert.equal((await get(reads[0])).status, 403);
    const profile = await (await get("/searched-user/student")).json();
    assert.equal(profile.user.permissions.canViewStudentRecords, false);
  }
});

test("permission lookup failures cannot serve cached private responses", async t => {
  const get = await client(t); prime(reads[0]); scopeError = true;
  const old = console.error; console.error = () => {};
  try {
    assert.equal((await get(reads[0])).status, 500);
    assert.equal(privateReads, 0);
  } finally { console.error = old; }
});

test("admin and employer cache access is unchanged by the department-only guard", async t => {
  const get = await client(t);
  for (const role of ["admin", "employer"]) {
    prime(reads[0], role, role);
    const res = await get(reads[0], { role, id: role });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).marker, "private cached response");
  }
  assert.equal(scopeReads, 0); assert.equal(privateReads, 0);
});

test("membership comparison uses the latest academic row, never the token's department claim", async t => {
  t.after(() => database.close());
  const connection = { execute: async (sql, params) => [database.prepare(sql).all(...params)] };
  assert.equal(await canHeadReadStudentRecords(connection, "head", "student"), true);
  database.exec("INSERT INTO student_academic_info VALUES (2,'student',20)");
  assert.equal(await canHeadReadStudentRecords(connection, "head", "student"), false);
  database.exec("UPDATE dept_heads_background_info SET department_id=20");
  assert.equal(await canHeadReadStudentRecords(connection, "head", "student"), true);
  database.exec("UPDATE dept_heads_background_info SET department_id=NULL");
  assert.equal(await canHeadReadStudentRecords(connection, "head", "student"), false);
});


test("profile rotation record ID is returned only to the matching department head", async t => {
  const get = await client(t);
  for (const role of ["admin", "employer", "student", "department_head"]) {
    const res = await get("/searched-user/student", {role, id:role === "department_head" ? "head" : role});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.info.internship_id, role === "department_head" ? "internship" : undefined);
  }
});
