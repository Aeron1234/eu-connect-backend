import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../config/db.js';
import cache from '../config/cache/cache.js';
import { createUser } from '../features/accounts/controllers/accountControllers.js';

const originalGetConnection = db.getConnection;
const originalFetch = global.fetch;
// Account creation now dispatches invitations. Never let local .env credentials
// turn this mocked-database regression into a live EmailJS delivery attempt.
global.fetch = async () => new Response('OK');
after(async () => { db.getConnection = originalGetConnection; global.fetch = originalFetch; cache.close(); await db.end(); });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const request = email => ({ verifiedUser: { id: 'admin', role: 'admin' }, body: {
  email, username: 'new.account', password: 'TEST-ONLY-password', first_name: 'New', last_name: 'Account', role: '1',
} });

test('missing, blank and non-string emails fail before database access', async () => {
  db.getConnection = async () => assert.fail('invalid email must not acquire a connection');
  for (const email of [undefined, null, '', ' \t\n ', 123, false, [], ['person@example.test'], {}]) {
    const res = response(); await createUser(request(email), res);
    assert.equal(res.statusCode, 400); assert.equal(res.body.message, 'Email address is required.');
  }
});

test('malformed email addresses fail before database access', async () => {
  db.getConnection = async () => assert.fail('invalid email must not acquire a connection');
  for (const email of ['person', 'person@example', 'person @example.test', 'person@@example.test', '@example.test']) {
    const res = response(); await createUser(request(email), res);
    assert.equal(res.statusCode, 400); assert.equal(res.body.message, 'Invalid email format.');
  }
});

test('every new account role checks and stores the trimmed required email without changing role assignments', async () => {
  for (const role of ['student', 'employer', 'department_head', 'admin']) {
    const calls = []; let committed = false, released = false;
    db.getConnection = async () => ({
      async beginTransaction() {}, async rollback() {}, async commit() { committed = true; }, release() { released = true; },
      async execute(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('FROM roles')) return [[{ role }]];
        if (sql.includes('SELECT department_id FROM courses')) return [[{ department_id: 9 }]];
        if (sql.startsWith('SELECT id FROM users')) return [[]];
        return [{ affectedRows: 1 }];
      },
    });
    const req = request('  person@example.test  ');
    Object.assign(req.body, { course: '7', department: '8', gender: 'male' });
    const res = response(); await createUser(req, res);
    assert.equal(res.statusCode, 201, role); assert(committed); assert(released);
    assert.deepEqual(calls.find(x => x.sql.includes('WHERE email = ?')).params, ['person@example.test']);
    assert.equal(calls.find(x => x.sql.startsWith('INSERT INTO users')).params[1], 'person@example.test');
    if (role === 'student') assert.deepEqual(calls.find(x => x.sql.includes('INSERT INTO student_academic_info')).params.slice(1), [7, 9]);
    if (role === 'department_head') assert.equal(calls.find(x => x.sql.includes('INSERT INTO dept_heads_background_info')).params[1], 8);
  }
});

test('an existing email is rejected after trimming without creating an account or committing', async () => {
  let rolledBack = false, released = false;
  db.getConnection = async () => ({
    async beginTransaction() {}, async commit() { assert.fail('duplicate must not commit'); },
    async rollback() { rolledBack = true; }, release() { released = true; },
    async execute(sql, params) {
      if (sql.includes('FROM roles')) return [[{ role: 'employer' }]];
      if (sql.includes('WHERE username = ?')) return [[]];
      if (sql.includes('WHERE email = ?')) { assert.deepEqual(params, ['person@example.test']); return [[{ id: 'existing' }]]; }
      assert.fail('duplicate email must not write: ' + sql);
    },
  });
  const res = response(); await createUser(request(' person@example.test '), res);
  assert.equal(res.statusCode, 400); assert.equal(res.body.message, 'Email address is already in use.');
  assert(rolledBack); assert(released);
});
