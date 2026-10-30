import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { once } from 'node:events';
import { db } from '../config/db.js';
import cache from '../config/cache/cache.js';
import { assignDtrLocations, getDtrLocationStudents, getDtrLocationPins } from '../features/dtr-locations/dtrLocationController.js';
import { validateDtrLocation } from '../features/dtr-locations/locationRules.js';

process.env.ACCESS_TOKEN_SECRET = 'bulk-location-tests';
process.env.REFRESH_TOKEN_SECRET = 'bulk-location-refresh-tests';
process.env.TEMP_PASSWORD_SECRET = 'bulk-location-temp-tests';
const { default: routes } = await import('../features/dtr-locations/dtrLocationRoutes.js');
const { signAccessToken } = await import('../config/jwt.js');
const original = db.getConnection;
let database, emitted, committed, rolledBack, released, failNotification, failWrite, failCommit, statements;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const location = { lat: 13.93, lon: 121.43, radius_meter: 150, address: 'Hospital main entrance', label: 'Front desk' };

beforeEach(() => {
  database?.close();
  emitted = []; committed = 0; rolledBack = 0; released = 0; failNotification = false; failWrite = false; failCommit = false; statements = [];
  database = new DatabaseSync(':memory:');
  database.function('CONCAT_WS', (separator, ...parts) => parts.filter(p => p != null).join(separator));
  database.function('NOW', () => '2026-10-30 10:00:00');
  database.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,deleted_at TEXT);
    CREATE TABLE user_profiles(user_id TEXT PRIMARY KEY, first_name TEXT,last_name TEXT,avatar TEXT);
    CREATE TABLE departments(id INTEGER PRIMARY KEY,name TEXT,code TEXT);
    CREATE TABLE courses(id INTEGER PRIMARY KEY,course_name TEXT,short_name TEXT);
    CREATE TABLE dept_heads_background_info(user_id TEXT,department_id INTEGER);
    CREATE TABLE student_academic_info(id INTEGER PRIMARY KEY,user_id TEXT,department_id INTEGER,course_id INTEGER);
    CREATE TABLE internship_records(id TEXT PRIMARY KEY,user_id TEXT,employer_id TEXT,status TEXT,deleted_at TEXT,company_name TEXT,lat REAL,lon REAL,company_address TEXT);
    CREATE TABLE dtr_locations(id INTEGER PRIMARY KEY,internship_id TEXT UNIQUE,set_by TEXT,lat REAL,lon REAL,radius_meters INTEGER,label TEXT,address TEXT,updated_at TEXT);
    CREATE TABLE notifications(id INTEGER PRIMARY KEY,user_id TEXT,sender_id TEXT,type TEXT,title TEXT,message TEXT,link TEXT,link_uuid TEXT);
    CREATE TABLE activity_logs(actor_id TEXT,actor_role TEXT,action TEXT,target_type TEXT,target_id TEXT,description TEXT);
    INSERT INTO departments VALUES(1,'Computing','CCS'),(2,'Nursing','CN'),(3,'Registrar','REG');
    INSERT INTO courses VALUES(1,'Computer Science','BSCS'),(2,'Nursing','BSN');
    INSERT INTO dept_heads_background_info VALUES('head',1),('registrar',3);
    INSERT INTO user_profiles VALUES('admin','Admin','User',NULL),('head','Department','Head',NULL),('employer','Employer','User',NULL);
  `);
  for (let n = 1; n <= 14; n++) {
    database.prepare('INSERT INTO users VALUES(?,NULL)').run(`s${n}`);
    database.prepare('INSERT INTO user_profiles VALUES(?,?,?,?)').run(`s${n}`, 'Student', String(n).padStart(2, '0'), 'avatar.png');
    database.prepare('INSERT INTO student_academic_info VALUES(?,?,?,?)').run(n, `s${n}`, n <= 11 ? 1 : 2, n <= 11 ? 1 : 2);
    database.prepare('INSERT INTO internship_records VALUES(?,?,?,?,?,?,?,?,?)').run(id(n), `s${n}`, n <= 12 ? 'employer' : null, n === 14 ? 'finished' : 'ongoing', null, 'Hospital', 13.9, 121.4, 'Company site');
  }
  for (const n of [1, 12]) database.prepare('INSERT INTO dtr_locations(internship_id,set_by,lat,lon,radius_meters,address) VALUES(?,?,?,?,?,?)').run(id(n), 'admin', 13.9, 121.4, 150, 'Shared hospital');
  db.getConnection = async () => ({
    async beginTransaction() { database.exec('BEGIN'); },
    async commit() { if (failCommit) throw Error('commit failed'); database.exec('COMMIT'); committed++; },
    async rollback() { database.exec('ROLLBACK'); rolledBack++; },
    release() { released++; },
    async execute(sql, params = []) {
      statements.push({ sql, params });
      if ((failNotification && sql.startsWith('INSERT INTO notifications')) || (failWrite && sql.startsWith('INSERT INTO dtr_locations'))) throw Error('simulated database failure');
      const translated = sql.replace(/ FOR UPDATE$/, '').replace(/ON DUPLICATE KEY UPDATE.*$/s,
        'ON CONFLICT(internship_id) DO UPDATE SET set_by=excluded.set_by,lat=excluded.lat,lon=excluded.lon,radius_meters=excluded.radius_meters,label=excluded.label,address=excluded.address,updated_at=NOW()');
      if (sql.startsWith('SELECT')) return [database.prepare(translated).all(...params).map(row => ({ ...row }))];
      const result = database.prepare(translated).run(...params);
      return [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }];
    },
  });
});
after(async () => { database?.close(); db.getConnection = original; cache.close(); await db.end(); });
function req(role = 'admin', actor = role, body = {}, query = {}) {
  return { verifiedUser: { id: actor, role, department_code: 'CCS', department_id: 999 }, body, query,
    app: { get: () => ({ to: room => ({ emit: (event, payload) => { assert(committed > 0); emitted.push({ room, event, payload }); } }) }) } };
}
async function call(handler, request) {
  const response = { statusCode: 200, set() {}, status(status) { this.statusCode = status; return this; }, json(body) { this.body = body; return this; } };
  await handler(request, response); return response;
}
const save = (role, ids, actor = role) => call(assignDtrLocations, req(role, actor, { ...location, internshipIds: ids }));

test('admin sees all ongoing interns, dependent courses, stable paging and grouped custom pins', async () => {
  const first = await call(getDtrLocationStudents, req());
  assert.equal(first.body.students.length, 10); assert.equal(first.body.pagination.total, 13);
  const page = await call(getDtrLocationStudents, req('admin', 'admin', {}, { page: '2' }));
  assert.equal(page.body.students.length, 3);
  const nursing = await call(getDtrLocationStudents, req('admin', 'admin', {}, { departmentId: '2' }));
  assert.deepEqual(nursing.body.courses.map(c => c.short_name), ['BSN']);
  assert.equal(nursing.body.students.length, 2);
  const pins = await call(getDtrLocationPins, req());
  assert.equal(pins.body.locations.length, 1); assert.equal(pins.body.locations[0].students.length, 2);
  assert.equal(first.body.students[1].company_location.radius_meters, 150);
});
test('head reads and shared-pin membership are scoped by current department, not JWT claims', async () => {
  const head = await call(getDtrLocationStudents, req('department_head', 'head'));
  assert.equal(head.body.pagination.total, 11);
  const pins = await call(getDtrLocationPins, req('department_head', 'head'));
  assert.deepEqual(pins.body.locations[0].students.map(s => s.user_id), ['s1']);
  database.prepare('INSERT INTO student_academic_info VALUES(100,?,?,?)').run('s1', 2, 2);
  const moved = await call(getDtrLocationPins, req('department_head', 'head'));
  assert.equal(moved.body.locations.length, 0);
});
test('Registrar, missing department and student roles cannot read or write', async () => {
  for (const request of [req('department_head', 'registrar'), req('department_head', 'missing'), req('student', 's1')]) {
    for (const handler of [getDtrLocationStudents, getDtrLocationPins]) assert.equal((await call(handler, request)).statusCode, 403);
    const result = await call(assignDtrLocations, { ...request, body: { ...location, internshipIds: [id(1)] } });
    assert.equal(result.statusCode, 403);
  }
  assert.equal(database.prepare('SELECT COUNT(*) n FROM notifications').get().n, 0);
});
test('staff assignment groups employer notice, notifies every changed student and skips missing supervisors', async () => {
  const result = await save('admin', [id(1), id(2), id(13)]);
  assert.deepEqual(result.body.summary, { assigned: 3, unchanged: 0, failed: 0 });
  const notices = database.prepare('SELECT * FROM notifications').all();
  assert.equal(notices.length, 4);
  const employers = notices.filter(n => n.user_id === 'employer');
  assert.equal(employers.length, 1); assert.match(employers[0].message, /Student 01, Student 02/); assert.match(employers[0].message, /Admin User/);
  assert(!employers[0].message.includes('Student 13'));
  assert(notices.every(n => n.message.includes('Hospital main entrance') && n.message.includes('clock-in and clock-out')));
  assert.equal(committed, 1); assert.equal(released, 1); assert.equal(emitted.filter(e => e.event === 'new_notification').length, 4);
  const again = await save('admin', [id(1), id(2), id(13)]);
  assert.deepEqual(again.body.summary, { assigned: 0, unchanged: 3, failed: 0 });
  assert.equal(database.prepare('SELECT COUNT(*) n FROM notifications').get().n, 4);
});
test('head cannot assign another department, finished/deleted internships or deleted students; reports partial results', async () => {
  database.prepare('UPDATE users SET deleted_at=? WHERE id=?').run('today', 's2');
  database.prepare('UPDATE internship_records SET deleted_at=? WHERE id=?').run('today', id(3));
  const result = await save('department_head', [id(1), id(2), id(3), id(12), id(14), id(99)], 'head');
  assert.deepEqual(result.body.summary, { assigned: 1, unchanged: 0, failed: 5 });
  assert(result.body.results.filter(r => r.status === 'failed').every(r => !r.name));
  assert.equal(database.prepare('SELECT COUNT(*) n FROM notifications').get().n, 2);
  assert(statements.some(({ sql }) => sql.endsWith('ORDER BY ir.id FOR UPDATE')));
});
test('employer sees and assigns only ongoing supervised interns; cannot inject department/course filters', async () => {
  const read = await call(getDtrLocationStudents, req('employer'));
  assert.equal(read.body.pagination.total, 12); assert.deepEqual(read.body.courses, []);
  for (const query of [{ departmentId: '1' }, { courseId: '1' }]) assert.equal((await call(getDtrLocationStudents, req('employer', 'employer', {}, query))).statusCode, 400);
  const result = await save('employer', [id(1), id(13)]);
  assert.equal(result.body.summary.assigned, 1); assert.equal(result.body.summary.failed, 1);
  assert.deepEqual(database.prepare('SELECT user_id FROM notifications').all().map(n => n.user_id), ['s1']);
});
test('assignment moves membership between pins and supports a single-student pin', async () => {
  await save('admin', [id(1)]);
  const pins = await call(getDtrLocationPins, req());
  assert.equal(pins.body.locations.length, 2);
  assert(pins.body.locations.every(g => g.students.length === 1));
});
test('separate supervisors receive one notice each and bulk size does not add per-student SQL round trips', async () => {
  database.prepare('UPDATE internship_records SET employer_id=? WHERE id=?').run('other-employer', id(3));
  await save('admin', [id(1), id(2), id(3)]);
  const notices = database.prepare('SELECT user_id,message FROM notifications WHERE user_id IN (?,?)').all('employer', 'other-employer');
  assert.equal(notices.length, 2);
  assert.match(notices.find(n => n.user_id === 'employer').message, /Student 01, Student 02/);
  assert.match(notices.find(n => n.user_id === 'other-employer').message, /Student 03/);
  assert.equal(statements.filter(s => s.sql.startsWith('INSERT INTO dtr_locations')).length, 1);
  assert.equal(statements.filter(s => s.sql.startsWith('INSERT INTO notifications')).length, 1);
});
test('name/course filters apply equally to table and pin membership and wildcard characters remain literal', async () => {
  const filters = { departmentId: '2', courseId: '2', search: 'Student 12' };
  const list = await call(getDtrLocationStudents, req('admin', 'admin', {}, filters));
  const pins = await call(getDtrLocationPins, req('admin', 'admin', {}, filters));
  assert.deepEqual(list.body.students.map(s => s.user_id), ['s12']);
  assert.deepEqual(pins.body.locations[0].students.map(s => s.user_id), ['s12']);
  const literal = await call(getDtrLocationStudents, req('admin', 'admin', {}, { search: '%' }));
  assert.equal(literal.body.pagination.total, 0);
});
test('write, notification or commit failure rolls back assignments and notices without emitting success', async () => {
  for (const failure of ['write', 'notification', 'commit']) {
    failWrite = failure === 'write'; failNotification = failure === 'notification'; failCommit = failure === 'commit';
    const result = await save('admin', [id(1), id(2)]);
    assert.equal(result.statusCode, 500); assert.equal(result.body.success, false);
    assert.equal(database.prepare('SELECT lat FROM dtr_locations WHERE internship_id=?').get(id(1)).lat, 13.9);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM notifications').get().n, 0);
    assert.equal(database.prepare('SELECT COUNT(*) n FROM activity_logs').get().n, 0);
    assert.equal(emitted.length, 0);
  }
  assert.equal(rolledBack, 3); assert.equal(released, 3);
});
test('coordinates, database text lengths, whole-number radius and selection limits are validated before writes', async () => {
  for (const body of [{ lat: '', lon: 121 }, { lat: true, lon: 121 }, { lat: 91, lon: 121 }, { lat: 13, lon: Infinity }, { ...location, radius_meter: 19 }, { ...location, radius_meter: 2001 }, { ...location, radius_meter: 20.5 }, { ...location, address: 'a'.repeat(256) }, { ...location, label: [] }]) assert.throws(() => validateDtrLocation(body));
  assert.equal(validateDtrLocation({ lat: 0, lon: 0 }).radius_meters, 150);
  for (const ids of [[], [id(1), id(1)], ['bad'], Array.from({ length: 101 }, (_, n) => id(n))]) assert.equal((await save('admin', ids)).statusCode, 400);
  assert.equal(committed, 0);
});
test('authenticated mounted routes reject students and unauthenticated access on both API prefixes', async t => {
  const app = express(); app.use(express.json()); app.use(['/api/v1', '/eu-connect/api'], routes);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  for (const prefix of ['/api/v1', '/eu-connect/api']) {
    const url = `http://127.0.0.1:${server.address().port}${prefix}/dtr-locations/students`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${signAccessToken({ id: 's1', role: 'student' })}` } })).status, 403);
    const admin = await fetch(url, { headers: { Authorization: `Bearer ${signAccessToken({ id: 'admin', role: 'admin' })}` } });
    assert.equal(admin.status, 200); assert.equal(admin.headers.get('cache-control'), 'private, no-store');
  }
});
