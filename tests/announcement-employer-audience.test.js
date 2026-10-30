import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { db } from "../config/db.js";
import cache from "../config/cache/cache.js";
import { createAnnouncement, updateAnnouncement, getAllAnnouncements, getAnnouncementById } from "../features/announcements/controllers/announcementControllers.js";

after(async () => { cache.close(); await db.end(); });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
async function fixture(run) {
  const sql = new DatabaseSync(":memory:");
  sql.function("DATE_FORMAT", (value, format) => format && value ? value.slice(0, 10) : null);
  sql.function("IF", (condition, yes, no) => condition ? yes : no);
  sql.exec(`CREATE TABLE roles(id INTEGER, role TEXT);
    CREATE TABLE users(id TEXT, role_id INTEGER);
    CREATE TABLE user_profiles(user_id TEXT, first_name TEXT, last_name TEXT);
    CREATE TABLE announcement_categories(id INTEGER, name TEXT, color TEXT, text_color TEXT);
    CREATE TABLE dept_heads_background_info(user_id TEXT, department_id INTEGER);
    CREATE TABLE departments(id INTEGER PRIMARY KEY, name TEXT, code TEXT);
    CREATE TABLE student_academic_info(id INTEGER, user_id TEXT, department_id INTEGER);
    CREATE TABLE announcements(id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT, author_id TEXT, category_id INTEGER,
      title TEXT, content TEXT, event_date TEXT, event_end_date TEXT, visible_to_employers INTEGER NOT NULL DEFAULT 0,
      is_pinned INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, sender_id TEXT, type TEXT, title TEXT, message TEXT, link TEXT, link_uuid TEXT);
    CREATE TABLE activity_logs(actor_id TEXT, actor_role TEXT, action TEXT, target_type TEXT, target_id TEXT, description TEXT, metadata TEXT);
    INSERT INTO roles VALUES(1,'admin'),(2,'department_head'),(3,'student'),(4,'employer');
    INSERT INTO users VALUES('author',1),('head',2),('other-head',2),('student',3),('other-student',3),('employer',4);
    INSERT INTO user_profiles SELECT id,id,'User' FROM users;
    INSERT INTO announcement_categories VALUES(1,'General','red','white'),(2,'Department','blue','white');
    INSERT INTO dept_heads_background_info VALUES('head',1),('other-head',2);
    INSERT INTO departments VALUES(1,'College of Computer Studies','CCS'),(2,'Other Department','OTHER');
    INSERT INTO student_academic_info VALUES(1,'student',1),(2,'other-student',2);`);
  const original = { execute: db.execute, getConnection: db.getConnection };
  const execute = async (statement, params = []) => {
    const query = sql.prepare(statement.replace(/\s+FOR UPDATE/g, ""));
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
  const invoke = async (handler, { role = "admin", id = "author", body = {}, params = {}, query = {}, department_id = 1 } = {}) => {
    const res = response();
    await handler({ verifiedUser: { id, role, department_id, department_code: "CCS" }, body, params, query,
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
