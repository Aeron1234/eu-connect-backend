import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { db } from "../config/db.js";
import { getEmployerInternsPage } from "../features/dashboard/controllers/dashboardController.js";
import { deleteNotification, getAllNotifications } from "../features/notifications/controllers/notificationControllers.js";

const response = () => ({ statusCode: 200, locals: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

async function fixture(run) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE internship_records (id TEXT PRIMARY KEY, user_id TEXT, employer_id TEXT, status TEXT, deleted_at TEXT, internship_position TEXT, date_started TEXT, date_ended TEXT, total_hours REAL, accumulated_hours REAL);
    CREATE TABLE supervisor_requests (id TEXT PRIMARY KEY, internship_id TEXT, student_id TEXT, employer_id TEXT, status TEXT, created_at TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);
    CREATE TABLE user_profiles (user_id TEXT, first_name TEXT, last_name TEXT);
    CREATE TABLE student_academic_info (id INTEGER PRIMARY KEY, user_id TEXT, course_id INTEGER);
    CREATE TABLE courses (id INTEGER PRIMARY KEY, course_name TEXT, short_name TEXT);
    CREATE TABLE announcements (id INTEGER, public_id TEXT, visible_to_employers INTEGER DEFAULT 0);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id TEXT, sender_id TEXT, type TEXT, title TEXT, message TEXT, link TEXT, link_uuid TEXT, is_read INTEGER DEFAULT 0, created_at TEXT);
    INSERT INTO courses VALUES (1,'Computer Science','BSCS'),(2,'Hospitality','BSHM');
  `);
  let releases = 0;
  const calls = [];
  const original = db.getConnection;
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(statement, params = []) {
      calls.push({ statement, params });
      const query = sql.prepare(statement);
      return statement.trim().startsWith("DELETE")
        ? [{ affectedRows: Number(query.run(...params).changes) }]
        : [query.all(...params).map(row => ({ ...row }))];
    },
  });
  const add = (index, { employer = null, target = "employer", status = "ongoing", deleted = null, requestStatus = "pending", notification = true } = {}) => {
    const student = "student-" + index, record = "internship-" + index, request = "request-" + index;
    sql.prepare("INSERT INTO users VALUES (?,?)").run(student, student + "@test.invalid");
    sql.prepare("INSERT INTO user_profiles VALUES (?,?,?)").run(student, "Student", String(index));
    sql.prepare("INSERT INTO internship_records VALUES (?,?,?,?,?,?,?,?,?,?)").run(record, student, employer, status, deleted, "Intern", "2026-10-01", "2026-12-01", 300, 50);
    sql.prepare("INSERT INTO student_academic_info VALUES (?,?,?)").run(index * 10, student, 1);
    sql.prepare("INSERT INTO student_academic_info VALUES (?,?,?)").run(index * 10 + 1, student, 2);
    sql.prepare("INSERT INTO supervisor_requests VALUES (?,?,?,?,?,?)").run(request, record, student, target, requestStatus, "2026-10-20 08:00:00");
    if (notification) sql.prepare("INSERT INTO notifications VALUES (?,?,?,?,?,?,?,?,?,?)").run(index, target, student, "supervisor_request_submitted", "New request", "Please supervise", null, request, 0, "2026-10-20");
    return { student, record, request };
  };
  const invoke = async (handler, query = {}, id = "employer", params = {}) => {
    const res = response();
    await handler({ verifiedUser: { id, role: "employer" }, query, params }, res);
    return res;
  };
  try { await run({ sql, add, invoke, calls, releases: () => releases }); }
  finally { db.getConnection = original; sql.close(); }
}

test("restored dashboard lists only assigned interns and excludes pending requests", async () => fixture(async ({ add, invoke }) => {
  add(1, { notification: false });
  add(2, { target: "other-employer" });
  add(3, { employer: "employer", requestStatus: "accepted" });
  add(4, { employer: "employer", requestStatus: "accepted", status: "finished" });
  const all = await invoke(getEmployerInternsPage, { status: "all" });
  assert.equal(all.statusCode, 200);
  assert.equal(all.body.total, 2);
  assert.deepEqual(all.body.interns.map(row => row.student_id).sort(), ["student-3", "student-4"]);
  assert.equal(all.body.interns[0].course_name, "Hospitality");
  const ongoing = await invoke(getEmployerInternsPage, { status: "ongoing" });
  assert.deepEqual(ongoing.body.interns.map(row => row.student_id), ["student-3"]);
  const finished = await invoke(getEmployerInternsPage, { status: "finished" });
  assert.deepEqual(finished.body.interns.map(row => row.student_id), ["student-4"]);
  const requests = await invoke(getEmployerInternsPage, { status: "requests" });
  assert.equal(requests.statusCode, 400);
}));

test("restored intern pagination remains bounded without pending request rows", async () => fixture(async ({ add, invoke }) => {
  for (let i = 1; i <= 8; i++) add(i, { employer: "employer", requestStatus: "accepted", notification: false });
  add(9, { notification: false });
  const first = await invoke(getEmployerInternsPage, { status: "all", page: "1" });
  const second = await invoke(getEmployerInternsPage, { status: "all", page: "2" });
  assert.equal(first.body.total, 8); assert.equal(first.body.totalPages, 2);
  assert.equal(first.body.interns.length, 5); assert.equal(second.body.interns.length, 3);
  assert.equal(new Set([...first.body.interns, ...second.body.interns].map(row => row.student_id)).size, 8);
  const beyond = await invoke(getEmployerInternsPage, { status: "all", page: "99" });
  assert.deepEqual(beyond.body.interns, []); assert.equal(beyond.body.total, 8);
}));

test("dashboard groups repeated assignments before pagination and filters individual positions", async () => fixture(async ({ add, invoke, sql }) => {
  for (let i = 1; i <= 6; i++) add(i, { employer: "employer", requestStatus: "accepted", notification: false });
  sql.exec("INSERT INTO internship_records VALUES('prior','student-1','employer','finished',NULL,'Support intern','2026-08-01','2026-09-01',100,103.6)");
  sql.exec("INSERT INTO internship_records VALUES('foreign','student-1','other-employer','finished',NULL,'Other employer position','2026-08-01','2026-09-01',100,100)");
  const first = await invoke(getEmployerInternsPage, { status: "all", page: "1" });
  const second = await invoke(getEmployerInternsPage, { status: "all", page: "2" });
  assert.equal(first.body.total, 6); assert.equal(first.body.totalPages, 2);
  const students = [...first.body.interns, ...second.body.interns];
  assert.equal(new Set(students.map(student => student.student_id)).size, 6);
  const repeat = students.find(student => student.student_id === "student-1");
  assert.equal(repeat.placements.length, 2);
  assert.deepEqual(repeat.placements.map(placement => placement.status), ["ongoing", "finished"]);
  assert.equal(repeat.placements[1].accumulated_hours, 103.6);
  assert(!JSON.stringify(students).includes("Other employer position"));
  const completed = await invoke(getEmployerInternsPage, { status: "finished" });
  assert.equal(completed.body.total, 1);
  assert.deepEqual(completed.body.interns[0].placements.map(placement => placement.internship_id), ["prior"]);
  const ongoing = await invoke(getEmployerInternsPage, { status: "ongoing", page: "2" });
  assert(ongoing.body.interns.every(student => student.placements.every(placement => placement.status === "ongoing")));
}));

test("unanswered active notification deletion is denied even through a direct API call", async () => fixture(async ({ add, invoke, sql }) => {
  add(1);
  const inbox = await invoke(getAllNotifications);
  assert.equal(inbox.body.data[0].actionable, true);
  assert.equal(inbox.body.data[0].can_delete, false);
  const blocked = await invoke(deleteNotification, {}, "employer", { notificationId: "1" });
  assert.equal(blocked.statusCode, 409); assert.match(blocked.body.error, /Accept or decline/);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM notifications").get().n, 1);
  const forbidden = await invoke(deleteNotification, {}, "other-employer", { notificationId: "1" });
  assert.equal(forbidden.statusCode, 404);
  sql.exec("UPDATE supervisor_requests SET status='accepted'; UPDATE internship_records SET employer_id='employer'");
  const answered = await invoke(getAllNotifications);
  assert.equal(answered.body.data[0].actionable, false); assert.equal(answered.body.data[0].can_delete, true);
  assert.equal((await invoke(deleteNotification, {}, "employer", { notificationId: "1" })).statusCode, 200);
}));

test("employer inbox counts and rows follow current announcement visibility without exposing calendar alerts", async () => fixture(async ({ invoke, sql }) => {
  sql.exec(`INSERT INTO announcements VALUES(1,'shared-general',1),(2,'private',0),(3,'shared-department',1);
    INSERT INTO notifications VALUES(1,'employer',NULL,'announcement','Shared','Visible',NULL,'shared-general',0,'2026-10-30'),
      (2,'employer',NULL,'announcement','Private','Hidden',NULL,'private',0,'2026-10-30'),
      (3,'employer',NULL,'announcement','Department','Visible',NULL,'shared-department',0,'2026-10-30'),
      (4,'employer',NULL,'calendar_schedule','Calendar','Hidden',NULL,NULL,0,'2026-10-30');`);
  let res = await invoke(getAllNotifications);
  assert.equal(res.body.totalRecords, 2); assert.equal(res.body.unreadCount, 2);
  assert.deepEqual(res.body.data.map(row => row.title).sort(), ["Department", "Shared"]);
  sql.exec("UPDATE announcements SET visible_to_employers=0 WHERE id=1");
  res = await invoke(getAllNotifications);
  assert.equal(res.body.totalRecords, 1); assert.equal(res.body.unreadCount, 1);
}));

test("declined, cancelled, obsolete and ordinary alerts can be deleted", async () => fixture(async ({ add, invoke, sql }) => {
  add(1, { requestStatus: "rejected" });
  add(2, { requestStatus: "superseded" });
  add(3, { status: "finished" });
  add(4, { deleted: "2026-10-22" });
  add(5, { employer: "another-employer" });
  add(6); sql.exec("UPDATE notifications SET type='certificate_accepted' WHERE id=6");
  for (let i = 1; i <= 6; i++) assert.equal((await invoke(deleteNotification, {}, "employer", { notificationId: String(i) })).statusCode, 200);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM notifications").get().n, 0);
}));

test("legacy links receive the same pending protection and never trust forged notification ownership", async () => fixture(async ({ add, invoke, sql }) => {
  add(1); sql.exec("UPDATE notifications SET link=link_uuid,link_uuid=NULL");
  assert.equal((await invoke(deleteNotification, {}, "employer", { notificationId: "1" })).statusCode, 409);
  sql.exec("UPDATE notifications SET user_id='other-employer'");
  assert.equal((await invoke(getAllNotifications, {}, "other-employer")).body.data[0].actionable, false);
  assert.equal((await invoke(deleteNotification, {}, "other-employer", { notificationId: "1" })).statusCode, 200);
}));
