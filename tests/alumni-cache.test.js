import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import cache from "../config/cache/cache.js";
import { db } from "../config/db.js";
import * as alumni from "../features/past-internships/controllers/alumniRecordControllers.js";

process.env.ACCESS_TOKEN_SECRET = "alumni-test-access";
process.env.REFRESH_TOKEN_SECRET = "alumni-test-refresh";
process.env.TEMP_PASSWORD_SECRET = "alumni-test-temp";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_KEY = "test-only-no-network";
process.env.CACHE_ENABLED = "true";
const { default: routes } = await import("../features/past-internships/routes/alumniRecordRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const internships = await import("../features/internship-records/controllers/internshipRecordControllers.js");
const originalGetConnection = db.getConnection;
const base = "/eu-connect/api/";
let calls, connection, mode, status, committed, emitted, activityLog;
beforeEach(() => {
  cache.flushAll(); calls = 0; mode = "success"; status = "ongoing"; committed = false; emitted = 0; activityLog = null;
  connection = {
    async beginTransaction() {}, async rollback() {}, release() {},
    async commit() {
      assert.ok(cache.has("alumni-a")); assert.ok(cache.has("directory-b"));
      if (mode === "commit-failure") throw new Error("failed commit");
      committed = true;
    },
    async query() { return [{ affectedRows: 1 }]; },
    async execute(sql, params) {
      calls++;
      if (sql.includes("INSERT INTO activity_logs")) activityLog = params;
      if (mode === "read-error") throw new Error("offline");
      if (!sql.trim().startsWith("SELECT")) return [{ affectedRows: 1, insertId: 1 }];
      if (mode === "empty") return sql.includes("COUNT(DISTINCT") ? [[{ total: 0 }]] : [[]];
      if (sql.includes("SELECT DISTINCT academic_year")) return [[{ academic_year: "2025-2026" }]];
      if (sql.includes("COUNT(DISTINCT")) return [[{ total: 1 }]];
      if (sql.includes("AS normalized_name")) return mode === "out-of-range" ? [[]] : [[{ normalized_name: "company", company_name: "Company", total: 1 }]];
      if (sql.includes("SELECT air.id, air.alumni_name")) return [[{ id: "a", company_name: "Company", company_address: "City", industry: "IT", alumni_name: "Graduate", course_id: 1, course_name: "Computing", academic_year: "2025-2026", department_id: 1 }]];
      if (sql.includes("SELECT ir.company_name, c.course_name")) return [[{ company_name: "Company", course_name: "Computing" }]];
      if (sql.includes("SELECT air.company_name, c.course_name")) return [[{ company_name: " company ", course_name: "Business" }]];
      if (sql.includes("FOR UPDATE") && mode === "missing") return [[]];
      if (sql.includes("FROM dept_heads_background_info WHERE")) return [[{ department_id: mode === "wrong-department" ? 2 : 1 }]];
      return [[{ id: "record", user_id: "student", department_id: 1, course_id: 1, status, deleted_at: null,
        alumni_name: "Graduate",
        company_name: "Company", company_address: "City", industry: "IT", internship_position: "Intern",
        total_hours: 100, accumulated_hours: 100, date_started: "2025-08-01", academic_year: "2025-2026",
        first_name: "Test", last_name: "User" }]];
    },
  };
  db.getConnection = async () => connection;
});
after(async () => { db.getConnection = originalGetConnection; cache.close(); await db.end(); });
async function client(t) {
  const app = express(); app.use(base.slice(0, -1), routes);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return (path, role = "student", id = "viewer", department_id = 1) => fetch(`http://127.0.0.1:${server.address().port}${base}${path}`, {
    headers: id ? { Authorization: `Bearer ${signAccessToken({ id, role, department_id })}` } : {},
  });
}
function seed() {
  for (const [key, path] of [["alumni-a", "alumni-internships"], ["alumni-b", "alumni-internships"], ["directory-a", "company-directory"], ["directory-b", "company-directory"], ["profile", "account/user"]]) cache.set(key, { userId: key, path: base + path, body: {} });
}
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
const data = { alumni_name: "Graduate", company_name: "Company", company_address: "City", industry: "IT", course_id: 1, batch_year: "2026", academic_year: "2025-2026", internship_position: "Intern", description: "Placement", date_started: "2025-08-01", date_ended: "2026-01-01", total_hours: 100, lat: 14, lon: 121, region_id: 1, semester: "1st", status: "ongoing" };
function request(role = "admin", body = data) {
  return { verifiedUser: { id: "actor", role, department_id: 1 }, params: { recordId: "record", internshipId: "record" }, body,
    app: { get: () => ({ to: () => ({ emit: () => { assert.ok(committed); assert.equal(cache.has("alumni-a"), false); emitted++; } }) }) } };
}
const lifecycle = [
  ["createInternshipRecord", "student", "ongoing"],
  ["approveInternshipRecord", "admin", "pending"],
  ["markInternshipFinished", "admin", "ongoing"],
  ["finishInternshipRecord", "student", "ongoing"],
  ["restoreInternshipRecord", "admin", "rejected"],
  ["deleteInternshipRecord", "admin", "ongoing"],
];

test("alumni grouping and merged directory cache for sixty seconds", async (t) => {
  const get = await client(t);
  const grouped = await (await get("alumni-internships")).json(); assert.equal(grouped.data[0].alumni_count, 1); assert.equal(grouped.academicYears[0], "2025-2026");
  const before = calls; assert.deepEqual(await (await get("alumni-internships")).json(), grouped); assert.equal(calls, before);
  const directory = await (await get("company-directory")).json(); assert.equal(directory.length, 1); assert.equal(directory[0].intern_count, 2); assert.deepEqual(directory[0].courses, ["Computing", "Business"]);
  const after = calls; await get("company-directory"); assert.equal(calls, after);
  for (const key of cache.keys()) { const ttl = cache.getTtl(key) - Date.now(); assert.ok(ttl > 55000 && ttl <= 60000); }
});

test("year/search/page/limit and user/context keys remain separate with role checks", async (t) => {
  const get = await client(t);
  for (const query of ["", "?academicYear=2025-2026", "?search=Company", "?page=2", "?limit=20"]) {
    const before = calls; assert.equal((await get("alumni-internships" + query)).status, 200); assert.equal(calls, before + 3);
    await get("alumni-internships" + query); assert.equal(calls, before + 3);
  }
  let before = calls; await get("alumni-internships", "student", "other"); assert.equal(calls, before + 3);
  before = calls; await get("alumni-internships", "student", "viewer", 2); assert.equal(calls, before + 3);
  for (const path of ["alumni-internships", "company-directory"]) {
    assert.equal((await get(path, "employer")).status, 403); assert.equal((await get(path, "student", null)).status, 401);
  }
});

test("group page carries its total and empty out-of-range pages count without loading rows", async (t) => {
  const get = await client(t);
  const queries = [];
  const execute = connection.execute;
  connection.execute = async (sql, params) => { queries.push({ sql, params }); return execute(sql, params); };
  const first = await (await get("alumni-internships?search=Company&limit=5")).json();
  assert.equal(first.pagination.total, 1);
  assert.equal(first.pagination.totalPages, 1);
  assert.equal(queries.length, 3);
  assert.match(queries[1].sql, /COUNT\(\*\) OVER\(\) AS total/);
  assert.ok(!queries.some(({ sql }) => sql.includes("COUNT(DISTINCT")));
  assert.deepEqual(queries[1].params.slice(-2), [5, 0]);

  queries.length = 0;
  mode = "out-of-range";
  const beyond = await (await get("alumni-internships?page=3&limit=5")).json();
  assert.deepEqual(beyond.data, []);
  assert.deepEqual(beyond.pagination, { page: 3, limit: 5, total: 1, totalPages: 1 });
  assert.equal(queries.length, 3);
  assert.ok(queries[2].sql.includes("COUNT(DISTINCT"));
  assert.ok(!queries.some(({ sql }) => sql.includes("SELECT air.id, air.alumni_name")));
});

test("manual alumni writes clear every page of both views only after commit", async () => {
  for (const handler of [alumni.addAlumniInternshipRecord, alumni.updateAlumniInternshipRecord, alumni.deleteAlumniInternshipRecord]) {
    cache.flushAll(); seed(); const res = response(); await handler(request(), res);
    assert.ok(res.statusCode < 300); assert.deepEqual(cache.keys(), ["profile"]);
  }
});

test("alumni edits and deletes log the alumni and company while retaining record IDs", async () => {
  for (const handler of [alumni.updateAlumniInternshipRecord, alumni.deleteAlumniInternshipRecord]) {
    seed();
    const res = response();
    await handler(request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(activityLog[4], "record");
    assert.match(activityLog[5], /Graduate at Company/);
    assert.ok(!activityLog[5].includes("record record"));
    cache.flushAll();
  }
});

test("all six internship lifecycle paths clear merged directory and alumni before socket delivery", async () => {
  for (const [name, role, state] of lifecycle) {
    cache.flushAll(); seed(); status = state; committed = false; const res = response();
    await internships[name](request(role), res); assert.ok(res.statusCode < 300, name + ': ' + JSON.stringify(res.body));
    assert.deepEqual(cache.keys(), ["profile"]); assert.ok(committed);
  }
  assert.ok(emitted > 0);
});

test("failed commits across manual writes and lifecycle paths preserve both caches", async () => {
  const error = console.error; const log = console.log;
  try {
    console.error = () => {}; console.log = () => {}; mode = "commit-failure";
    for (const [handler, role, state] of [
      ...[alumni.addAlumniInternshipRecord, alumni.updateAlumniInternshipRecord, alumni.deleteAlumniInternshipRecord].map(fn => [fn, "admin", "ongoing"]),
      ...lifecycle.map(([name, role, state]) => [internships[name], role, state]),
    ]) {
      cache.flushAll(); seed(); status = state; const res = response(); await handler(request(role), res);
      assert.equal(res.statusCode, 500); assert.equal(cache.keys().length, 5); assert.equal(emitted, 0);
    }
  } finally { console.error = error; console.log = log; }
});

test("department ownership failures and missing alumni records preserve caches", async () => {
  for (const failure of ["wrong-department", "missing"]) for (const handler of [alumni.updateAlumniInternshipRecord, alumni.deleteAlumniInternshipRecord]) {
    cache.flushAll(); seed(); mode = failure; const res = response(); await handler(request("department_head"), res);
    assert.equal(res.statusCode, failure === "missing" ? 404 : 403); assert.equal(cache.keys().length, 5);
  }
});

test("database failures are not cached and empty lists are cached", async (t) => {
  const get = await client(t); const error = console.error;
  try {
    console.error = () => {}; mode = "read-error";
    for (const path of ["alumni-internships", "company-directory"]) assert.equal((await get(path)).status, 500);
    assert.equal(cache.keys().length, 0);
  } finally { console.error = error; }
  mode = "empty";
  assert.deepEqual((await (await get("alumni-internships")).json()).data, []);
  assert.deepEqual(await (await get("company-directory")).json(), []);
  const before = calls; await get("alumni-internships"); await get("company-directory"); assert.equal(calls, before);
});

test("HTE reports follow all internship commits and preserve caches on rollback", async () => {
  const error=console.error; const log=console.log; console.error=()=>{};console.log=()=>{};
  try { for(const failed of [false,true]) for(const [name,role,state] of lifecycle) {
    cache.flushAll();seed(); status=state;mode=failed?"commit-failure":"success";
    for(const path of ["academic-years","hte-annual/companies","hte-annual/company"]) cache.set(path,{path:base+"reports/"+path,userId:"viewer",body:{}});
    cache.set("annual",{path:base+"reports/annex-c",userId:"viewer",body:{}});
    const res=response();await internships[name](request(role),res);
    assert.equal(res.statusCode,failed?500:res.statusCode);assert.ok(failed || res.statusCode<300);
    for(const path of ["academic-years","hte-annual/companies","hte-annual/company"]) assert.equal(cache.has(path),failed);
    assert.ok(cache.has("annual"));
  }} finally {console.error=error;console.log=log;}
});

test("past internship caches clear after all lifecycle commits and survive rollback", async()=>{
 const error=console.error,log=console.log;console.error=()=>{};console.log=()=>{};
 try{for(const failed of [false,true])for(const [name,role,state] of lifecycle){
 cache.flushAll();seed();status=state;mode=failed?"commit-failure":"success";
 for(const id of ["one","two"])cache.set("past-"+id,{path:base+"internships/my-past-internships",userId:id,body:[]});
 const res=response();await internships[name](request(role),res);assert.ok(failed?res.statusCode===500:res.statusCode<300);
 for(const id of ["one","two"])assert.equal(cache.has("past-"+id),failed);
 }}finally{console.error=error;console.log=log;}
});

test("staff lists invalidate for lifecycle commits and survive rollback",async()=>{
const error=console.error,log=console.log;console.error=()=>{};console.log=()=>{};
try{for(const failed of [false,true])for(const [name,role,state]of lifecycle){cache.flushAll();seed();status=state;mode=failed?"commit-failure":"success";
for(const path of ["internship-records/department","internships/all","internships/active/all","searched-user/files/student","student-past-evaluations/student","searched-user/weekly-narratives/student","searched-user/student","internship-records/overview/i","searched-user/dtrs/student"])cache.set(path,{path:base+path,userId:"viewer",body:[]});
const res=response();await internships[name](request(role),res);assert.ok(failed?res.statusCode===500:res.statusCode<300);
for(const path of ["internship-records/department","internships/all","internships/active/all","searched-user/files/student","student-past-evaluations/student","searched-user/weekly-narratives/student","searched-user/student","internship-records/overview/i","searched-user/dtrs/student"])assert.equal(cache.has(path),failed);
}}finally{console.error=error;console.log=log;}});

test("forced completion logs the student full name and preserves student ID metadata",async()=>{
 seed();const execute=connection.execute;let description,metadata;
 connection.execute=async(sql,params)=>{if(sql.includes("INSERT INTO activity_logs")&&params[2]==="internship_record_force_finished"){description=params[5];metadata=JSON.parse(params[6]);}return execute(sql,params);};
 const res=response();await internships.markInternshipFinished(request("admin"),res);assert.ok(res.statusCode<300);assert.ok(description.includes("student: Test User"));assert.equal(metadata.student_id,"student");
});
