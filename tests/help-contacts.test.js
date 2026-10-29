import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { db } from "../config/db.js";
import { getHelpAdminContacts } from "../features/users/controllers/helpContactsController.js";

test("Help contacts expose only active admins with usable contact fields to students and heads", async () => {
  const memory = new DatabaseSync(":memory:");
  memory.exec(`CREATE TABLE roles(id INTEGER, role TEXT);
    CREATE TABLE users(id TEXT, role_id INTEGER, status TEXT, deleted_at TEXT, email TEXT);
    CREATE TABLE user_profiles(user_id TEXT, first_name TEXT, last_name TEXT, contact_number TEXT);
    INSERT INTO roles VALUES(1,'admin'),(2,'employer');
    INSERT INTO users VALUES('a',1,'active',NULL,' admin@example.test '),('b',1,'active',NULL,NULL),
      ('c',1,'inactive',NULL,'inactive@example.test'),('d',1,'active','2026-10-01','deleted@example.test'),
      ('e',2,'active',NULL,'employer@example.test'),('f',1,'active',NULL,'bad-address');
    INSERT INTO user_profiles VALUES('a','Admin','One',NULL),('b','Admin','Two','0912 345 6789'),
      ('f','No','Contact','not-set');`);
  const original = db.execute;
  let reads = 0;
  db.execute = async sql => { reads++; return [memory.prepare(sql).all()]; };
  const response = () => ({ statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  try {
    for (const role of ["student", "department_head"]) {
      const res = response(); await getHelpAdminContacts({ verifiedUser: { role } }, res);
      assert.equal(res.statusCode, 200); assert.equal(res.headers["Cache-Control"], "private, no-store");
      assert.deepEqual(res.body.contacts, [
        { name: "Admin One", email: "admin@example.test", contact_number: null },
        { name: "Admin Two", email: null, contact_number: "0912 345 6789" },
      ]);
    }
    for (const role of ["employer", "admin", undefined]) {
      const res = response(); await getHelpAdminContacts({ verifiedUser: { role } }, res);
      assert.equal(res.statusCode, 403); assert.equal(res.body.contacts, undefined);
    }
    assert.equal(reads, 2);
    memory.exec("DELETE FROM users");
    const empty = response(); await getHelpAdminContacts({ verifiedUser: { role: "student" } }, empty);
    assert.deepEqual(empty.body.contacts, []);
    db.execute = async () => { throw new Error("read outage"); };
    const savedError = console.error; console.error = () => {};
    try {
      const failed = response(); await getHelpAdminContacts({ verifiedUser: { role: "student" } }, failed);
      assert.equal(failed.statusCode, 500); assert.equal(failed.body.contacts, undefined);
    } finally { console.error = savedError; }
  } finally { db.execute = original; memory.close(); await db.end(); }
});
