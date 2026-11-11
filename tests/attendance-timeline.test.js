import test from 'node:test';
import assert from 'node:assert/strict';
import { readAttendanceTimeline } from '../features/dtr/attendanceTimeline.js';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_KEY ||= 'no-network';
const { db } = await import('../config/db.js');
const { getDepartmentAttendance } = await import('../features/dtr/controllers/departmentAttendanceController.js');
const { getAllDTRs } = await import('../features/dtr/controllers/dtrControllers.js');
const response = () => ({ statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('unified head attendance applies department and all filters to both timeline sources', async () => {
  const original = db.getConnection, calls = [];
  db.getConnection = async () => ({ release() {}, async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('SELECT h.department_id')) return [[{ department_id: 2, code: 'CCS' }]];
    if (sql.includes('FROM courses')) return [[]];
    if (sql.startsWith('SELECT COUNT')) return [[{ total: 1 }]];
    if (sql.startsWith('SELECT * FROM (')) return [[{ kind: 'absence', row_id: 3 }]];
    return [[{ id: 3, shift_date: '2026-11-11', student_id: 's', category: 'absent' }]];
  } });
  try {
    const res = response();
    await getDepartmentAttendance({ verifiedUser: { id: 'head', role: 'department_head' }, query: {
      search: 'Juan Cruz', company: 'BDO', courseId: '5', internshipId: 'ir', from: '2026-11-01', through: '2026-11-30',
    } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.rows[0].absence_staff, true);
    const count = calls.find(call => call.sql.startsWith('SELECT COUNT'));
    assert.equal((count.sql.match(/sai.department_id = \?/g) || []).length, 2);
    assert.match(count.sql, /r.shift_date >= \?/);
    assert.deepEqual(count.params, [2, '%juan cruz%', '%bdo%', 5, 'ir', '2026-11-01', '2026-11-30', 2, '%juan cruz%', '%bdo%', 5, 'ir', '2026-11-01', '2026-11-30']);
  } finally { db.getConnection = original; }
});

test('unified attendance denies Registrar and other roles before reading any absence data', async () => {
  const original = db.getConnection, calls = [];
  db.getConnection = async () => ({ release() {}, async execute(sql) { calls.push(sql); return [[{ department_id: 1, code: 'REG' }]]; } });
  try {
    for (const role of ['admin', 'employer', 'student', 'department_head']) {
      const res = response();
      await getDepartmentAttendance({ verifiedUser: { id: 'viewer', role }, query: {} }, res);
      assert.equal(res.statusCode, 403);
    }
    assert(!calls.some(sql => sql.includes('dtr_absence_reports')));
  } finally { db.getConnection = original; }
});

test('student timeline binds both sources to the authenticated owner and internship', async () => {
  const original = db.getConnection, calls = [];
  db.getConnection = async () => ({ release() {}, async execute(sql, params) {
    calls.push({ sql, params }); return sql.startsWith('SELECT COUNT') ? [[{ total: 0 }]] : [[]];
  } });
  try {
    const res = response();
    await getAllDTRs({ verifiedUser: { id: 'student', role: 'student' }, query: { internshipId: 'ir' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls[0].params, ['ir', 'student', 'ir', 'student']);
    assert.equal(res.body.totalPages, 1);
    calls.length = 0;
    await getAllDTRs({ verifiedUser: { id: 'employer', role: 'employer' }, query: { internshipId: 'ir' } }, response());
    assert(!calls.some(call => call.sql.includes('dtr_absence_reports')));
  } finally { db.getConnection = original; }
});

test('combined pagination scopes both sources and returns mixed rows in database order', async () => {
  const calls = [];
  const responses = [[{ total: 3 }], [{ kind: 'absence', row_id: 7 }, { kind: 'dtr', row_id: 4 }],
    [{ id: 4, total_hours: 8 }], [{ id: 7, shift_date: '2026-11-11', category: 'leave' }]];
  const connection = { execute: async (sql, params) => { calls.push({ sql, params }); return [responses.shift()]; } };
  const result = await readAttendanceTimeline(connection, {
    attendance: { fields: 'dtr.*', from: 'FROM daily_time_records dtr', where: 'WHERE dtr.user_id = ?', params: ['viewer'] },
    absences: { fields: 'r.*', from: 'FROM dtr_absence_reports r', where: 'WHERE r.student_id = ?', params: ['viewer'] },
    limit: 2, offset: 2,
  });
  assert.equal(result.total, 3);
  assert.deepEqual(result.rows.map(row => row.id), ['absence-7', 4]);
  assert.equal(result.rows[0].status, 'Leave');
  assert.equal(result.rows[0].total_hours, 0);
  assert.deepEqual(calls[1].params, ['viewer', 'viewer', 2, 2]);
  assert.match(calls[0].sql, /NOT EXISTS/);
  assert.match(calls[1].sql, /ORDER BY sort_date DESC/);
  assert.deepEqual(calls[3].params, ['viewer', 7, 4]);
});

test('a corrected report is attached to its attendance entry instead of adding a second row', async () => {
  const responses = [[{ total: 1 }], [{ kind: 'dtr', row_id: 9 }], [{ id: 9, total_hours: 6 }],
    [{ id: 2, correction_dtr_id: 9, review_status: 'corrected' }]];
  const connection = { execute: async () => [responses.shift()] };
  const source = { fields: '*', from: 'FROM test', where: 'WHERE owner = ?', params: ['owner'] };
  const result = await readAttendanceTimeline(connection, { attendance: source, absences: source, limit: 5, offset: 0 });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].absence_report.id, 2);
  assert.equal(result.rows[0].total_hours, 6);
});
