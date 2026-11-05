import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../config/db.js';
import { saveShiftRestriction, removeShiftRestriction } from '../features/dtr-locations/shiftRestrictionController.js';

const original = db.getConnection;
async function call(handler, { owner = true, body = { clockInTime: '22:00', clockOutTime: '06:00' } } = {}) {
  const statements = [];
  let committed = false, rolledBack = false;
  db.getConnection = async () => ({
    async beginTransaction() {},
    async execute(sql, params) {
      statements.push(sql);
      if (sql.startsWith('SELECT ir.id')) return [owner ? [{ id: 'internship' }] : []];
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
  const denied = await call(saveShiftRestriction, { owner: false });
  assert.equal(denied.status, 403);
  assert.equal(denied.rolledBack, true);
  assert.ok(!denied.statements.some(sql => sql.startsWith('INSERT')));
  const removed = await call(removeShiftRestriction);
  assert.equal(removed.status, 200);
  assert.ok(removed.statements.some(sql => sql.startsWith('DELETE')));
});

test('invalid or identical hours are rejected before a database write', async () => {
  const result = await call(saveShiftRestriction, { body: { clockInTime: '09:00', clockOutTime: '09:00' } });
  assert.equal(result.status, 400);
  assert.equal(result.statements.length, 0);
});
