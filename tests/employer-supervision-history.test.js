import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import express from "express";

process.env.ACCESS_TOKEN_SECRET = "history-test-access";
process.env.REFRESH_TOKEN_SECRET = "history-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "history-test-temp";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_KEY = "no-network";
const { db } = await import("../config/db.js");
const { default: cache } = await import("../config/cache/cache.js");
const { default: router } = await import("../features/users/routes/searchedUserRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const original = { getConnection: db.getConnection, execute: db.execute };
const memory = new DatabaseSync(":memory:");
memory.function("DATE_FORMAT", (value, pattern) => value && pattern === "%Y-%m-%d" ? String(value).slice(0, 10) : null);
memory.exec(`CREATE TABLE roles(id INTEGER, role TEXT);
  CREATE TABLE users(id TEXT, role_id INTEGER, deleted_at TEXT, email TEXT);
  CREATE TABLE user_profiles(user_id TEXT, first_name TEXT, last_name TEXT);
  CREATE TABLE courses(id INTEGER, course_name TEXT, short_name TEXT);
  CREATE TABLE student_academic_info(id INTEGER, user_id TEXT, course_id INTEGER);
  CREATE TABLE internship_records(id TEXT, user_id TEXT, employer_id TEXT, status TEXT, deleted_at TEXT,
    company_name TEXT, internship_position TEXT, date_started TEXT, date_ended TEXT);`);
let server, base, acquired, released, failQueries;
before(async () => {
  const app = express(); app.use("/api/v1", router);
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}/api/v1/searched-user`;
});
beforeEach(() => {
  cache.flushAll(); acquired = 0; released = 0; failQueries = false;
  memory.exec(`DELETE FROM internship_records; DELETE FROM student_academic_info; DELETE FROM courses;
    DELETE FROM user_profiles; DELETE FROM users; DELETE FROM roles;
    INSERT INTO roles VALUES(1,'student'),(2,'employer'),(3,'department_head'),(4,'admin');
    INSERT INTO users VALUES('employer',2,NULL,'private-employer@example.test'),('other',2,NULL,NULL),('student-a',1,NULL,'private-student@example.test'),('student-b',1,NULL,NULL),('deleted-student',1,'2026-10-01',NULL),('deleted-employer',2,'2026-10-01',NULL);
    INSERT INTO user_profiles VALUES('student-a','Anna','Cruz'),('student-b','Ben','Reyes'),('deleted-student','Deleted','Student');
    INSERT INTO courses VALUES(1,'Old course','OLD'),(2,'BS Computer Science','BSCS');
    INSERT INTO student_academic_info VALUES(1,'student-a',1),(2,'student-a',2),(3,'student-b',2);`);
  const insert = memory.prepare("INSERT INTO internship_records VALUES(?,?,?,?,?,?,?,?,?)");
  for (let i = 1; i <= 7; i++) insert.run(`finished-${i}`, i % 2 ? "student-a" : "student-b", "employer", "finished", null, "Company", "Intern", "2026-08-01", `2026-10-${String(i).padStart(2, "0")}`);
  for (const status of ["pending", "rejected"]) insert.run(status, "student-a", "employer", status, null, "Company", "Intern", "2026-08-01", "2026-11-01");
  insert.run("other-employer", "student-a", "other", "finished", null, "Other company", "Intern", "2026-08-01", "2026-11-01");
  insert.run("deleted-record", "student-a", "employer", "finished", "2026-10-01", "Company", "Intern", "2026-08-01", "2026-11-01");
  insert.run("deleted-account", "deleted-student", "employer", "finished", null, "Company", "Intern", "2026-08-01", "2026-11-01");
  db.execute = async () => [{ affectedRows: 1 }];
  db.getConnection = async () => {
    acquired++;
    return { release() { released++; }, async execute(sql, params) {
      if (failQueries) throw new Error("simulated read outage");
      return [memory.prepare(sql).all(...params)];
    } };
  };
});
after(async () => {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  Object.assign(db, original); cache.close(); await db.end(); memory.close();
});
function request(target = "employer", query = "", role = "student") {
  return fetch(`${base}/${encodeURIComponent(target)}/supervised-interns${query}`, {
    headers: role ? { Authorization: `Bearer ${signAccessToken({ id: `viewer-${role}`, role })}` } : {},
  });
}

test("all four signed-in roles can read basic completed supervision history", async () => {
  for (const role of ["student", "employer", "department_head", "admin"]) {
    const response = await request("employer", "", role), body = await response.json();
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(body.pagination, { page: 1, pageSize: 5, total: 2, totalPages: 1 });
    assert.deepEqual(body.interns.map(item => item.student_id), ["student-a", "student-b"]);
    assert.deepEqual(body.interns[0].placements.map(item => item.internship_id), ["finished-7", "finished-5", "finished-3", "finished-1"]);
    assert.deepEqual(body.interns[1].placements.map(item => item.internship_id), ["finished-6", "finished-4", "finished-2"]);
    assert(body.interns.every(item => item.course_name === "BS Computer Science"));
    for (const item of body.interns) {
      assert.deepEqual(Object.keys(item).sort(), ["student_id", "first_name", "last_name", "course_name", "short_name", "placements"].sort());
      for (const placement of item.placements) assert.deepEqual(Object.keys(placement).sort(), ["internship_id", "status", "company_name", "internship_position", "date_started", "date_ended"].sort());
    }
    assert(!JSON.stringify(body).includes("private-student")); assert.equal(acquired, released);
  }
});

test("current-only supervisors are visible and repeated ongoing/finished placements share one student", async () => {
  memory.exec("DELETE FROM internship_records WHERE employer_id='employer'; INSERT INTO internship_records VALUES('current','student-a','employer','ongoing',NULL,'Company','Developer','2026-10-01',NULL)");
  let body = await (await request()).json();
  assert.equal(body.pagination.total, 1);
  assert.equal(body.interns[0].placements[0].status, "ongoing");
  assert.equal(body.interns[0].placements[0].date_ended, null);
  memory.exec("INSERT INTO internship_records VALUES('prior','student-a','employer','finished',NULL,'Company','Support','2026-08-01','2026-09-01')");
  body = await (await request()).json();
  assert.equal(body.pagination.total, 1);
  assert.deepEqual(body.interns[0].placements.map(item => item.status), ["ongoing", "finished"]);
});

test("history pages are stable, separate by employer and exclude pending/rejected/deleted placements", async () => {
  // Six students, not eleven placements, must produce two pages. Both repeat
  // students keep their older records together on their respective pages.
  for (const suffix of ["c", "d", "e", "f"]) {
    memory.prepare("INSERT INTO users VALUES(?,1,NULL,NULL)").run(`student-${suffix}`);
    memory.prepare("INSERT INTO internship_records VALUES(?,?,?,?,?,?,?,?,?)").run(`new-${suffix}`, `student-${suffix}`, "employer", "finished", null, "Company", "New position", "2026-08-01", "2026-11-01");
  }
  const first = await (await request()).json();
  assert.deepEqual(first.pagination, { page: 1, pageSize: 5, total: 6, totalPages: 2 });
  assert.equal(first.interns.length, 5);
  let response = await request("employer", "?page=2"), body = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(body.interns.map(item => item.student_id), ["student-b"]);
  assert.deepEqual(body.interns[0].placements.map(item => item.internship_id), ["finished-6", "finished-4", "finished-2"]);
  const all = [...first.interns, ...body.interns];
  assert.equal(new Set(all.map(item => item.student_id)).size, 6);
  assert.equal(all.flatMap(item => item.placements).length, 11);
  assert.equal(all.find(item => item.student_id === "student-a").placements.length, 4);
  response = await request("other"); body = await response.json(); assert.equal(body.pagination.total, 1); assert.equal(body.interns[0].placements[0].company_name, "Other company");
  memory.exec("DELETE FROM internship_records WHERE employer_id='other'");
  body = await (await request("other")).json(); assert.deepEqual(body.interns, []); assert.equal(body.pagination.total, 0);
  body = await (await request("employer", "?page=100")).json(); assert.equal(body.pagination.page, 2); assert.equal(body.interns.length, 1);
});

test("anonymous/unsupported roles and invalid pages cannot read history; non-employer targets are rejected", async () => {
  assert.equal((await request("employer", "", null)).status, 401);
  assert.equal((await request("employer", "", "unsupported")).status, 403);
  for (const query of ["?page=0", "?page=-1", "?page=1.5", "?page=1e2", "?page=1000001", "?page=1&page=2"]) assert.equal((await request("employer", query)).status, 400);
  assert.equal(acquired, 0);
  for (const target of ["student-a", "missing", "deleted-employer", "' OR 1=1 --"]) assert.equal((await request(target)).status, 404);
  assert.equal(acquired, released);
});

test("database failures remain errors and release connections instead of appearing as empty history", async () => {
  failQueries = true;
  const originalError = console.error; console.error = () => {};
  try {
    const response = await request(), body = await response.json();
    assert.equal(response.status, 500); assert.match(body.error, /Could not load/); assert.equal(body.interns, undefined);
    assert.equal(acquired, released);
  } finally { console.error = originalError; }
});
