import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { db } from "../config/db.js";
import cache from "../config/cache/cache.js";
import { getUnreadNotificationCount, openAnnouncementNotification } from '../features/notifications/controllers/notificationControllers.js';
import { getCalendarMonth } from '../features/calendar/controllers/calendarControllers.js';
import { getAnnouncementTagStudents } from '../features/announcements/studentTags.js';
import { createAnnouncement, updateAnnouncement, getAllAnnouncements, getAnnouncementById } from "../features/announcements/controllers/announcementControllers.js";

after(async () => { cache.close(); await db.end(); });
const taggedStudent = '00000000-0000-4000-8000-000000000001';
const response = () => ({ statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
async function fixture(run) {
  const sql = new DatabaseSync(":memory:");
  sql.function("DATE_FORMAT", (value, format) => format && value ? value.slice(0, 10) : null);
  sql.function('CONCAT_WS', (separator,...parts) => parts.filter(p=>p!=null).join(separator));
  sql.function("IF", (condition, yes, no) => condition ? yes : no);
  sql.exec(`CREATE TABLE roles(id INTEGER, role TEXT);
    CREATE TABLE users(id TEXT, role_id INTEGER, deleted_at TEXT);
    CREATE TABLE user_profiles(user_id TEXT, first_name TEXT, last_name TEXT);
    CREATE TABLE announcement_categories(id INTEGER, name TEXT, color TEXT, text_color TEXT);
    CREATE TABLE dept_heads_background_info(user_id TEXT, department_id INTEGER);
    CREATE TABLE departments(id INTEGER PRIMARY KEY, name TEXT, code TEXT);
    CREATE TABLE student_academic_info(id INTEGER, user_id TEXT, department_id INTEGER);
    CREATE TABLE announcements(id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, author_id TEXT, category_id INTEGER,
      title TEXT, content TEXT, event_date TEXT, event_end_date TEXT, visible_to_employers INTEGER NOT NULL DEFAULT 0, employer_tagged_only INTEGER NOT NULL DEFAULT 0, tagged_students_only INTEGER NOT NULL DEFAULT 0,
      is_pinned INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE announcement_student_tags(announcement_id TEXT,student_id TEXT);
    CREATE TABLE internship_records(user_id TEXT,employer_id TEXT,status TEXT,deleted_at TEXT);
    CREATE TABLE notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, sender_id TEXT, type TEXT, title TEXT, message TEXT, link TEXT, link_uuid TEXT, is_read INTEGER DEFAULT 0);
    CREATE TABLE activity_logs(actor_id TEXT, actor_role TEXT, action TEXT, target_type TEXT, target_id TEXT, description TEXT, metadata TEXT);
    INSERT INTO roles VALUES(1,'admin'),(2,'department_head'),(3,'student'),(4,'employer');
    INSERT INTO users(id,role_id) VALUES('author',1),('head',2),('other-head',2),('student',3),('other-student',3),('employer',4);
    INSERT INTO user_profiles SELECT id,id,'User' FROM users;
    INSERT INTO announcement_categories VALUES(1,'General','red','white'),(2,'Department','blue','white');
    INSERT INTO dept_heads_background_info VALUES('head',1),('other-head',2);
    INSERT INTO departments VALUES(1,'College of Computer Studies','CCS'),(2,'Other Department','OTHER');
    INSERT INTO student_academic_info VALUES(1,'student',1),(2,'other-student',2);`);
  const original = { execute: db.execute, getConnection: db.getConnection };
  const execute = async (statement, params = []) => {
    const query = sql.prepare(statement.replace(/\s+FOR UPDATE/g, "").replaceAll("JSON_ARRAYAGG", "json_group_array"));
    if (statement.trim().startsWith("SELECT")) return [query.all(...params.map(value => value ?? null))];
    return [{ affectedRows: Number(query.run(...params).changes) }];
  };
  db.execute = execute;
  db.getConnection = async () => ({ execute, release() {},
    async beginTransaction() { sql.exec("BEGIN"); }, async commit() { sql.exec("COMMIT"); },
    async rollback() { if (sql.isTransaction) sql.exec("ROLLBACK"); },
    async query(statement, [values]) {
      assert(statement.includes("INSERT INTO notifications"));
      const insert = sql.prepare("INSERT INTO notifications(user_id,sender_id,type,title,message,link_uuid) VALUES(?,?,?,?,?,?)");
      for (const row of values) insert.run(...row); return [{ affectedRows: values.length }];
    },
  });
  const emissions = [];
  const invoke = async (handler, { role = "admin", id = "author", body = {}, params = {}, query = {}, department_id = 1, department_code = "CCS" } = {}) => {
    const res = response();
    await handler({ verifiedUser: { id, role, department_id, department_code }, body, params, query,
      app: { get: () => ({ to: room => ({ emit: (event, payload) => { assert(!sql.isTransaction); emissions.push({ room, event, payload }); } }) }) } }, res);
    return res;
  };
  try { await run({ sql, invoke, emissions }); }
  finally { Object.assign(db, original); sql.close(); }
}

test("opted-in General and Department announcements notify employers without broadening school department scope", async () => fixture(async ({ sql, invoke }) => {
  for (const [role, id, category_id] of [["admin", "author", 1], ["department_head", "head", 2]]) {
    for (const visible_to_employers of [0, 1]) {
      const created = await invoke(createAnnouncement, { role, id, body: { category_id, title: "Shared notice", content: "Body", visible_to_employers } });
      assert.equal(created.statusCode, 201);
      const recipients = sql.prepare("SELECT user_id FROM notifications WHERE link_uuid=?").all(created.body.id).map(row => row.user_id);
      assert.equal(recipients.includes("employer"), visible_to_employers === 1);
      if (category_id === 2) { assert(recipients.includes("student")); assert(!recipients.includes("other-student")); assert(!recipients.includes("other-head")); }
      const item = await invoke(getAnnouncementById, { role: "employer", id: "employer", params: { announcementId: created.body.id } });
      assert.equal(item.statusCode, visible_to_employers ? 200 : 404);
      if (visible_to_employers) {
        assert.equal(item.body.author_department_name, category_id === 2 ? "College of Computer Studies" : null);
        assert.equal(item.body.author_department_code, category_id === 2 ? "CCS" : null);
      }
    }
  }
  const feed = await invoke(getAllAnnouncements, { role: "employer", id: "employer", query: { search: "Shared" } });
  assert.equal(feed.body.totalRecords, 2); assert(feed.body.regular.every(row => row.visible_to_employers === 1));
  assert.equal(feed.body.regular.find(row => row.category === "Department").author_department_code, "CCS");
  sql.exec("UPDATE announcements SET is_pinned=1 WHERE category_id=2 AND visible_to_employers=1");
  const pinned = await invoke(getAllAnnouncements, { role: "admin" });
  assert.equal(pinned.body.pinned[0].author_department_name, "College of Computer Studies");
  const updated = await invoke(updateAnnouncement, { role: "department_head", id: "head", params: { announcementId: pinned.body.pinned[0].id }, body: { title: "Updated Department notice" } });
  assert.equal(updated.statusCode, 200); assert.equal(updated.body.data.author_department_code, "CCS");
}));

test("author edits grant/revoke employer access without duplicate alerts or removing school notifications", async () => fixture(async ({ sql, invoke, emissions }) => {
  const created = await invoke(createAnnouncement, { body: { category_id: 1, title: "Notice", content: "Body" } });
  const params = { announcementId: created.body.id };
  const edit = body => invoke(updateAnnouncement, { params, body });
  assert.equal((await edit({ visible_to_employers: 1 })).statusCode, 200);
  assert.equal((await edit({ title: "Updated title" })).statusCode, 200);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id='employer'").get().n, 1);
  assert.equal(sql.prepare("SELECT visible_to_employers AS v FROM announcements").get().v, 1);
  const schoolCount = sql.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id!='employer'").get().n;
  assert.equal((await edit({ visible_to_employers: 0 })).statusCode, 200);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id='employer'").get().n, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id!='employer'").get().n, schoolCount);
  assert.equal((await invoke(getAnnouncementById, { role: "employer", id: "employer", params })).statusCode, 404);
  assert(emissions.some(event => event.room === "user-employer" && event.event === "announcements_changed"));
  assert.equal((await edit({ visible_to_employers: 1 })).statusCode, 200);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id='employer'").get().n, 1);
}));


test('tagged student announcements restrict feeds, direct links, unread counts and notification opening to the supervisor', async () => fixture(async ({sql,invoke}) => {
  sql.prepare('INSERT INTO users(id,role_id) VALUES(?,3)').run(taggedStudent);
  sql.prepare('INSERT INTO user_profiles VALUES(?,?,?)').run(taggedStudent,'Tagged','Student');
  sql.prepare('INSERT INTO student_academic_info VALUES(3,?,1)').run(taggedStudent);
  sql.prepare("INSERT INTO users(id,role_id) VALUES('unselected-employer',4)").run();
  sql.prepare("INSERT INTO internship_records VALUES(?,'employer','ongoing',NULL)").run(taggedStudent);
  const created = await invoke(createAnnouncement,{body:{category_id:1,title:'Intern notice',content:'Body',visible_to_employers:1,tagged_student_ids:JSON.stringify([taggedStudent])}});
  assert.equal(created.statusCode,201);
  const announcementId=created.body.id;
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM notifications WHERE link_uuid=? AND user_id='employer'").get(announcementId).n,1);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM notifications WHERE link_uuid=? AND user_id='unselected-employer'").get(announcementId).n,0);
  for(const [id,permitted] of [['employer',true],['unselected-employer',false]]) {
    const direct=await invoke(getAnnouncementById,{role:'employer',id,params:{announcementId}});
    assert.equal(direct.statusCode,permitted?200:404);
    const feed=await invoke(getAllAnnouncements,{role:'employer',id});
    assert.equal(feed.body.regular.length,permitted?1:0);
  }
  // Even a retained/stale notification must not grant access.
  sql.prepare("INSERT INTO notifications(user_id,type,link_uuid) VALUES('unselected-employer','announcement',?)").run(announcementId);
  const notice=sql.prepare("SELECT id FROM notifications WHERE user_id='unselected-employer'").get();
  const count=await invoke(getUnreadNotificationCount,{role:'employer',id:'unselected-employer'});
  assert.equal(count.body.unreadCount,0);
  const opened=await invoke(openAnnouncementNotification,{role:'employer',id:'unselected-employer',params:{notificationId:String(notice.id)}});
  assert.equal(opened.statusCode,403);
  // Current supervision changes revoke the former supervisor's access.
  sql.prepare("UPDATE internship_records SET employer_id='unselected-employer'").run();
  assert.equal((await invoke(getAnnouncementById,{role:'employer',id:'employer',params:{announcementId}})).statusCode,404);
  assert.equal((await invoke(getAnnouncementById,{role:'employer',id:'unselected-employer',params:{announcementId}})).statusCode,200);
  // Deleting the final tag must never broaden a restricted post to everyone.
  sql.prepare('DELETE FROM announcement_student_tags').run();
  assert.equal((await invoke(getAnnouncementById,{role:'employer',id:'unselected-employer',params:{announcementId}})).statusCode,404);
}));

test('authors cannot tag another departments students or nonexistent/finished interns; missing supervisors do not broaden access',async()=>fixture(async({sql,invoke})=>{
  sql.prepare('INSERT INTO users(id,role_id) VALUES(?,3)').run(taggedStudent);
  sql.prepare('INSERT INTO user_profiles VALUES(?,?,?)').run(taggedStudent,'Tagged','Student');
  sql.prepare('INSERT INTO student_academic_info VALUES(3,?,2)').run(taggedStudent);
  sql.prepare("INSERT INTO internship_records VALUES(?,NULL,'ongoing',NULL)").run(taggedStudent);
  const body={category_id:2,title:'Scoped',content:'Body',visible_to_employers:1,tagged_student_ids:[taggedStudent]};
  assert.equal((await invoke(createAnnouncement,{role:'department_head',id:'head',body})).statusCode,400);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM announcements').get().n,0);
  const created=await invoke(createAnnouncement,{body:{...body,category_id:1}});
  assert.equal(created.statusCode,201);
  assert.equal((await invoke(getAnnouncementById,{role:'employer',id:'employer',params:{announcementId:created.body.id}})).statusCode,404);
  sql.prepare("UPDATE internship_records SET status='finished'").run();
  assert.equal((await invoke(createAnnouncement,{body:{...body,category_id:1}})).statusCode,400);
}));

test('editing tags grants only the new supervisor audience, removes old employer notices, and retains tags in edit data',async()=>fixture(async({sql,invoke})=>{
  const second='00000000-0000-4000-8000-000000000002';
  sql.prepare("INSERT INTO users(id,role_id) VALUES('second-employer',4)").run();
  for(const [student,employer,n] of [[taggedStudent,'employer',3],[second,'second-employer',4]]) {
    sql.prepare('INSERT INTO users(id,role_id) VALUES(?,3)').run(student);
    sql.prepare('INSERT INTO user_profiles VALUES(?,?,?)').run(student,'Student',String(n));
    sql.prepare('INSERT INTO student_academic_info VALUES(?,?,1)').run(n,student);
    sql.prepare("INSERT INTO internship_records VALUES(?,?,'ongoing',NULL)").run(student,employer);
  }
  const created=await invoke(createAnnouncement,{body:{category_id:1,title:'Scoped',content:'Body',visible_to_employers:1,tagged_student_ids:[taggedStudent]}});
  const announcementId=created.body.id;
  const updated=await invoke(updateAnnouncement,{params:{announcementId},body:{tagged_student_ids:[second]}});
  assert.equal(updated.statusCode,200);
  assert.deepEqual(JSON.parse(updated.body.data.tagged_student_ids),[second]);
  const employers=sql.prepare("SELECT n.user_id FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.role_id=4 AND n.link_uuid=?").all(announcementId);
  assert.deepEqual(employers.map(row=>row.user_id),['second-employer']);
  assert.equal((await invoke(getAnnouncementById,{role:'employer',id:'employer',params:{announcementId}})).statusCode,404);
}));


test('regular heads search and tag multiple own-department students; Registrar and admin can tag across departments', async()=>fixture(async({sql,invoke})=>{
  const ids=[1,2,3].map(n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'));
  sql.exec("INSERT INTO departments VALUES(3,'Registrar','REG'); INSERT INTO users(id,role_id) VALUES('registrar',2); INSERT INTO user_profiles VALUES('registrar','Registrar','Head'); INSERT INTO dept_heads_background_info VALUES('registrar',3);");
  for(const [i,student] of ids.entries()) {
    sql.prepare('INSERT INTO users(id,role_id) VALUES(?,3)').run(student);
    sql.prepare('INSERT INTO user_profiles VALUES(?,?,?)').run(student,'Eligible',String(i));
    sql.prepare('INSERT INTO student_academic_info VALUES(?,?,?)').run(10+i,student,i===1?2:1);
    sql.prepare("INSERT INTO internship_records VALUES(?,'employer','ongoing',NULL)").run(student);
  }
  // A misleading token department/code cannot expand a regular head's picker.
  const own=await invoke(getAnnouncementTagStudents,{role:'department_head',id:'head',department_id:2,department_code:'REG'});
  assert.deepEqual(own.body.students.map(s=>s.id).sort(),[ids[0],ids[2]].sort());
  for(const actor of [{role:'admin',id:'author'},{role:'department_head',id:'registrar',department_id:3,department_code:'REG'}]) {
    const picker=await invoke(getAnnouncementTagStudents,actor);
    assert.equal(picker.body.students.length,3);
    const created=await invoke(createAnnouncement,{...actor,body:{category_id:1,title:'Several interns',content:'Body',visible_to_employers:1,tagged_student_ids:[ids[0],ids[1]]}});
    assert.equal(created.statusCode,201);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM announcement_student_tags WHERE announcement_id=?').get(created.body.id).n,2);
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM notifications WHERE link_uuid=? AND user_id='employer'").get(created.body.id).n,1);
  }
  const head={role:'department_head',id:'head'};
  const body={category_id:2,title:'Own interns',content:'Body',visible_to_employers:1,tagged_student_ids:[ids[0],ids[2]]};
  const created=await invoke(createAnnouncement,{...head,body});
  assert.equal(created.statusCode,201);
  const denied=await invoke(updateAnnouncement,{...head,params:{announcementId:created.body.id},body:{tagged_student_ids:[ids[0],ids[1]]}});
  assert.equal(denied.statusCode,400);
  assert.deepEqual(sql.prepare('SELECT student_id FROM announcement_student_tags WHERE announcement_id=? ORDER BY student_id').all(created.body.id).map(r=>r.student_id),[ids[0],ids[2]].sort());
}));


test('targeted audience restricts school feed/direct/calendar and notifies only involved students and heads plus opted-in supervisors',async()=>fixture(async({sql,invoke})=>{
  sql.prepare('INSERT INTO users(id,role_id) VALUES(?,3)').run(taggedStudent);
  sql.prepare('INSERT INTO user_profiles VALUES(?,?,?)').run(taggedStudent,'Tagged','Student');
  sql.prepare('INSERT INTO student_academic_info VALUES(10,?,1)').run(taggedStudent);
  sql.prepare("INSERT INTO internship_records VALUES(?,'employer','ongoing',NULL)").run(taggedStudent);
  sql.exec('CREATE TABLE calendar_schedules(id TEXT,created_by TEXT,department_id INTEGER,title TEXT,description TEXT,starts_on TEXT,ends_on TEXT);');
  const body={category_id:1,title:'Private notice',content:'Private',event_date:'2026-10-31',visible_to_employers:1,tagged_students_only:1,tagged_student_ids:[taggedStudent]};
  const created=await invoke(createAnnouncement,{body});assert.equal(created.statusCode,201);
  const announcementId=created.body.id;
  assert.deepEqual(sql.prepare('SELECT user_id FROM notifications WHERE link_uuid=? ORDER BY user_id').all(announcementId).map(r=>r.user_id),['employer','head',taggedStudent].sort());
  for(const [role,id,department_id,allowed] of [['student',taggedStudent,1,true],['student','student',1,false],['student','other-student',2,false],['department_head','head',1,true],['department_head','other-head',2,false],['admin','author',null,true]]) {
    const direct=await invoke(getAnnouncementById,{role,id,department_id,params:{announcementId}});assert.equal(direct.statusCode,allowed?200:404,id);
    const feed=await invoke(getAllAnnouncements,{role,id,department_id});assert.equal(feed.body.regular.length,allowed?1:0,id);
  }
  for(const [id,department_id,n] of [['head',1,1],['other-head',2,0]]) {
    const calendar=await invoke(getCalendarMonth,{role:'department_head',id,department_id,query:{month:'2026-10'}});
    assert.equal(calendar.statusCode,200);assert.equal(calendar.body.announcements.length,n);
  }
  sql.prepare("INSERT INTO notifications(user_id,type,link_uuid) VALUES('student','announcement',?)").run(announcementId);
  const count=await invoke(getUnreadNotificationCount,{role:'student',id:'student'});assert.equal(count.body.unreadCount,0);
  const notice=sql.prepare("SELECT id FROM notifications WHERE user_id='student'").get();
  assert.equal((await invoke(openAnnouncementNotification,{role:'student',id:'student',params:{notificationId:String(notice.id)}})).statusCode,403);
  // Widening the audience informs newly included people; narrowing removes their alerts.
  assert.equal((await invoke(updateAnnouncement,{params:{announcementId},body:{tagged_students_only:0}})).statusCode,200);
  assert.equal((await invoke(getAnnouncementById,{role:'student',id:'student',params:{announcementId}})).statusCode,200);
  assert.equal((await invoke(updateAnnouncement,{params:{announcementId},body:{tagged_students_only:1}})).statusCode,200);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id='student' AND link_uuid=?").get(announcementId).n,0);
}));

test('targeted audience requires a tag and cannot clear its last tag without switching back to the usual audience',async()=>fixture(async({sql,invoke})=>{
  const body={category_id:1,title:'Targeted',content:'Body',tagged_students_only:1,tagged_student_ids:[]};
  assert.equal((await invoke(createAnnouncement,{body})).statusCode,400);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM announcements').get().n,0);
  sql.prepare('INSERT INTO users(id,role_id) VALUES(?,3)').run(taggedStudent);
  sql.prepare('INSERT INTO user_profiles VALUES(?,?,?)').run(taggedStudent,'Tagged','Student');
  sql.prepare('INSERT INTO student_academic_info VALUES(10,?,1)').run(taggedStudent);
  sql.prepare("INSERT INTO internship_records VALUES(?,NULL,'ongoing',NULL)").run(taggedStudent);
  const created=await invoke(createAnnouncement,{body:{...body,tagged_student_ids:[taggedStudent]}});
  assert.equal(created.statusCode,201);
  assert.equal((await invoke(updateAnnouncement,{params:{announcementId:created.body.id},body:{tagged_student_ids:[]}})).statusCode,400);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM announcement_student_tags').get().n,1);
}));
