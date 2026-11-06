import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../config/db.js';
import { saveShiftRestriction, removeShiftRestriction } from '../features/dtr-locations/shiftRestrictionController.js';

const original = db.getConnection;
async function call(handler, { owner = true, existing = false, failNotification = false, body = { clockInTime: '22:00', clockOutTime: '06:00' } } = {}) {
  const statements = [];
  let committed = false, rolledBack = false;
  db.getConnection = async () => ({
    async beginTransaction() {},
    async execute(sql, params) {
      statements.push(sql);
      if (failNotification && sql.startsWith('INSERT INTO notifications')) throw new Error('notification write failed');
      if (sql.startsWith('SELECT ir.id')) return [owner ? [{ id: 'internship', user_id: 'student', company_name: 'Company', first_name: 'Ana', last_name: 'Cruz' }] : []];
      if (sql.includes('FROM dtr_shift_restrictions WHERE internship_id')) return [existing ? [{ clockInTime: '08:00', clockOutTime: '17:00', startDate: null, endDate: null }] : []];
      if (sql.startsWith('SELECT first_name')) return [[{ first_name: 'Employer', last_name: 'One' }]];
      return [{ affectedRows: 1 }];
    },
    async commit() { committed = true; },
    async rollback() { rolledBack = true; },
    release() {},
  });
  let status = 200, result;
  const res = { status(code) { status = code; return this; }, json(value) { result = value; return this; } };
  try {
    await handler({ params: { internshipId: 'internship' }, verifiedUser: { id: 'employer', role: 'employer' }, body }, res);
    return { status, result, statements, committed, rolledBack };
  } finally { db.getConnection = original; }
}

test('only a current supervisor can save or remove future shift hours', async () => {
  const saved = await call(saveShiftRestriction);
  assert.equal(saved.status, 200);
  assert.equal(saved.committed, true);
  assert.ok(saved.statements.some(sql => sql.includes('ON DUPLICATE KEY UPDATE')));
  assert.ok(saved.statements.some(sql => sql.startsWith('INSERT INTO notifications')));
  assert.ok(saved.statements.some(sql => sql.startsWith('INSERT INTO activity_logs')));
  const denied = await call(saveShiftRestriction, { owner: false });
  assert.equal(denied.status, 403);
  assert.equal(denied.rolledBack, true);
  assert.ok(!denied.statements.some(sql => sql.startsWith('INSERT')));
  const removed = await call(removeShiftRestriction, { existing: true });
  assert.equal(removed.status, 200);
  assert.ok(removed.statements.some(sql => sql.startsWith('DELETE')));
  assert.ok(removed.statements.some(sql => sql.startsWith('INSERT INTO notifications')));
});

test('optional inclusive dates validate before any database access', async () => {
  const valid = await call(saveShiftRestriction, { body: { clockInTime: '22:00', clockOutTime: '06:00', startDate: '2026-11-06', endDate: '2026-11-30' } });
  assert.equal(valid.status, 200);
  for (const dates of [{ startDate: '2026-11-31' }, { startDate: '2026-12-01', endDate: '2026-11-30' }]) {
    const result = await call(saveShiftRestriction, { body: { clockInTime: '08:00', clockOutTime: '17:00', ...dates } });
    assert.equal(result.status, 400);
    assert.equal(result.statements.length, 0);
  }
});

test('saving unchanged hours does not create another notification or activity log', async () => {
  const result = await call(saveShiftRestriction, {
    existing: true,
    body: { clockInTime: '08:00', clockOutTime: '17:00' },
  });
  assert.equal(result.status, 200);
  assert.ok(!result.statements.some(sql => sql.startsWith('INSERT INTO notifications')));
  assert.ok(!result.statements.some(sql => sql.startsWith('INSERT INTO activity_logs')));
});

test('a failed notification write rolls back the schedule and activity log', async () => {
  const result = await call(saveShiftRestriction, { failNotification: true });
  assert.equal(result.status, 500);
  assert.equal(result.committed, false);
  assert.equal(result.rolledBack, true);
  assert.ok(!result.statements.some(sql => sql.startsWith('INSERT INTO activity_logs')));
});

test('invalid or identical hours are rejected before a database write', async () => {
  const result = await call(saveShiftRestriction, { body: { clockInTime: '09:00', clockOutTime: '09:00' } });
  assert.equal(result.status, 400);
  assert.equal(result.statements.length, 0);
});
