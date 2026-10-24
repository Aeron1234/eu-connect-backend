import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createFeedbackService } from "../features/feedback/feedbackService.js";
import { createFeedbackFileCleanup } from "../features/feedback/feedbackFileCleanup.js";
function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.function("CONCAT_WS", { varargs: true }, (separator,...parts) => parts.filter(p => p != null).join(separator));
  sql.exec(`
    CREATE TABLE roles(id INTEGER PRIMARY KEY,role TEXT);
    CREATE TABLE users(id TEXT PRIMARY KEY,role_id INTEGER,deleted_at TEXT);
    CREATE TABLE user_profiles(user_id TEXT,first_name TEXT,last_name TEXT);
    CREATE TABLE dept_heads_background_info(user_id TEXT,department_id INTEGER);
    CREATE TABLE departments(id INTEGER PRIMARY KEY,code TEXT,name TEXT);
    CREATE TABLE student_academic_info(id INTEGER PRIMARY KEY,user_id TEXT,department_id INTEGER);
    CREATE TABLE internship_records(id TEXT,user_id TEXT,employer_id TEXT,company_name TEXT,internship_position TEXT,status TEXT,deleted_at TEXT);
    CREATE TABLE feedback_posts(id TEXT PRIMARY KEY,author_id TEXT,category TEXT,subject TEXT,description TEXT,status TEXT DEFAULT 'open',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,public_reply_version INTEGER DEFAULT 0,staff_reply_version INTEGER DEFAULT 0);
    CREATE TABLE feedback_mentions(post_id TEXT,internship_id TEXT,student_id TEXT,student_name TEXT,department_id INTEGER,department_code TEXT,department_name TEXT,company_name TEXT);
    CREATE TABLE feedback_attachments(id TEXT,post_id TEXT,storage_path TEXT,filename TEXT,mime_type TEXT,size_bytes INTEGER);
    CREATE TABLE feedback_replies(id TEXT PRIMARY KEY,post_id TEXT,author_id TEXT,body TEXT,is_internal INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE feedback_file_cleanup(id TEXT PRIMARY KEY,storage_path TEXT,attempts INTEGER DEFAULT 0,next_attempt_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE notifications(user_id TEXT,sender_id TEXT,type TEXT,title TEXT,message TEXT,link_uuid TEXT);
    INSERT INTO roles VALUES(1,'employer'),(2,'department_head'),(3,'admin'),(4,'student');
    INSERT INTO users VALUES('owner',1,NULL),('other',1,NULL),('head',2,NULL),('admin',3,NULL),('student',4,NULL);
    INSERT INTO user_profiles VALUES('owner','Owner','Employer'),('head','Department','Head'),('admin','School','Admin'),('student','Sample','Intern');
    INSERT INTO departments VALUES(1,'CCS','Computing');
    INSERT INTO dept_heads_background_info VALUES('head',1);
    INSERT INTO student_academic_info VALUES(1,'student',1);
    INSERT INTO internship_records VALUES('00000000-0000-4000-8000-000000000001','student','other','Company','Intern','ongoing',NULL);
  `);
  let active = 0, failDelete = false;
  const db = { async getConnection() {
    active++;
    return {
      async beginTransaction() { sql.exec("BEGIN"); }, async commit() { sql.exec("COMMIT"); }, async rollback() { sql.exec("ROLLBACK"); },
      release() { active--; },
      async execute(query, values=[]) {
        if (failDelete && query.startsWith("DELETE FROM feedback_posts")) throw new Error("delete failed");
        const translated = query.replace(/ FOR UPDATE/g,"").replace("DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE)", "datetime(CURRENT_TIMESTAMP,'+5 minutes')");
        const statement = sql.prepare(translated);
        return translated.trimStart().startsWith("SELECT") ? [statement.all(...values)] : [statement.run(...values)];
      },
    };
  } };
  const events = [];
  return { sql, db, service: createFeedbackService({ db, afterCommit: value => events.push(value) }), events,
    get active() { return active; }, failDelete() { failDelete = true; } };
}
const owner = {id:"owner",role:"employer"}, head={id:"head",role:"department_head"}, admin={id:"admin",role:"admin"};
const body = {category:"general_feedback",subject:"Initial",description:"Details",internshipIds:[]};
const file = (id,path="feedback/private/"+id+".pdf") => ({id,path,filename:id+".pdf",mime:"application/pdf",size:20});

test("only a post's author can edit/delete; new foreign internships and attachment IDs are rejected", async () => {
  const f=fixture();
  try {
    const {id}=await f.service.create(owner,body,[file("first")]);
    for(const user of [head,admin,{id:"other",role:"employer"},{id:"student",role:"student"}]){
      await assert.rejects(()=>f.service.update(user,id,body),error=>[403,404].includes(error.status));
      await assert.rejects(()=>f.service.remove(user,id),error=>[403,404].includes(error.status));
    }
    await assert.rejects(()=>f.service.update(owner,id,{...body,category:"internship_feedback",internshipIds:["00000000-0000-4000-8000-000000000001"]}),{status:403});
    await assert.rejects(()=>f.service.update(owner,id,{...body,removedAttachmentIds:["foreign"]}),{status:400});
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM feedback_file_cleanup").get().n,0);
    assert.equal((await f.service.detail(owner,id)).post.subject,"Initial");
  } finally { f.sql.close(); }
});
test("editing a post changes its audience and queues removed files atomically", async () => {
  const f=fixture();
  try {
    const {id}=await f.service.create(owner,body,[file("first")]);
    assert((await f.service.detail(head,id)).post);
    const updated=await f.service.update(owner,id,{...body,subject:"Updated",category:"technical_issue",removedAttachmentIds:["first"]},[file("second")]);
    assert.equal(updated.detail.post.subject,"Updated");
    assert.equal(updated.detail.attachments[0].id,"second");
    assert(!JSON.stringify(updated.detail).includes("feedback/private/"));
    await assert.rejects(()=>f.service.detail(head,id),{status:404});
    assert(updated.refreshRecipients.includes("head")); assert(!updated.recipients.includes("head"));
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id='head'").get().n,0);
    assert.deepEqual(f.sql.prepare("SELECT storage_path FROM feedback_file_cleanup").all().map(r=>r.storage_path),["feedback/private/first.pdf"]);
  } finally { f.sql.close(); }
});
test("reply authors can edit/delete their own public and internal replies; other participants cannot", async () => {
  const f=fixture();
  try {
    const {id}=await f.service.create(owner,body);
    const created=await f.service.reply(head,id,{body:"Original"});
    assert.equal((await f.service.detail(owner,id)).replies[0].author_id,"head");
    for(const user of [owner,admin]) await assert.rejects(()=>f.service.changeReply(user,id,created.replyId,{body:"Forged"}),{status:403});
    const edited=await f.service.changeReply(head,id,created.replyId,{body:"Corrected"});
    assert.equal(edited.reply.body,"Corrected");
    assert.equal(edited.replyVersion,2);
    await f.service.changeReply(head,id,created.replyId,null,true);
    assert.equal((await f.service.detail(owner,id)).replies.length,0);
    const publicVersion=(await f.service.detail(owner,id)).post.reply_version;
    const note=await f.service.reply(head,id,{body:"Internal",isInternal:true});
    await f.service.changeReply(head,id,note.replyId,{body:"Private correction"});
    await f.service.changeReply(head,id,note.replyId,null,true);
    assert.equal((await f.service.detail(owner,id)).post.reply_version,publicVersion);
    assert.equal((await f.service.detail(head,id)).post.reply_version,publicVersion+3);
    assert.equal(f.active,0);
  } finally { f.sql.close(); }
});
test("post deletion removes discussion rows/notifications and physically deletes files without holding a DB connection", async () => {
  const f=fixture();
  try {
    const {id}=await f.service.create(owner,body,[file("first"),file("second")]);
    await f.service.reply(head,id,{body:"Reply"});
    const result=await f.service.remove(owner,id);
    for(const table of ["feedback_posts","feedback_mentions","feedback_replies","feedback_attachments","notifications"]) assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM "+table).get().n,0,table);
    assert.equal(result.cleanupIds.length,2);
    const removed=[];
    const clean=createFeedbackFileCleanup({db:f.db,bucket:"private",storage:{from(){return{async remove(paths){assert.equal(f.active,0);removed.push(...paths);return{error:null};}}}}});
    assert.equal((await clean(result.cleanupIds)).pending,0);
    assert.deepEqual(removed.sort(),["feedback/private/first.pdf","feedback/private/second.pdf"]);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM feedback_file_cleanup").get().n,0);
  } finally { f.sql.close(); }
});
test("failed storage removal is retained for retry; failed database deletion rolls the queue and discussion back", async () => {
  const f=fixture();
  try {
    const {id}=await f.service.create(owner,body,[file("first")]);
    f.failDelete();
    await assert.rejects(()=>f.service.remove(owner,id),/delete failed/);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM feedback_attachments").get().n,1);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM feedback_file_cleanup").get().n,0);
    f.sql.prepare("INSERT INTO feedback_file_cleanup(id,storage_path) VALUES(?,?)").run("job","feedback/private/retry.pdf");
    let fail=true;
    const clean=createFeedbackFileCleanup({db:f.db,bucket:"private",storage:{from(){return{async remove(){return{error:fail?new Error("offline"):null};}}}}});
    assert.equal((await clean(["job"])).pending,1);
    assert.equal(f.sql.prepare("SELECT attempts FROM feedback_file_cleanup").get().attempts,1);
    fail=false;
    assert.equal((await clean(["job"])).pending,0);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM feedback_file_cleanup").get().n,0);
  } finally { f.sql.close(); }
});
