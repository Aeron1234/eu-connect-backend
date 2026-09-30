import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_KEY = 'no-network';

const { db } = await import('../config/db.js');
const {
  getMyPastInternshipRecords,
  getAllActiveInternships,
  getAllUserInternships,
} = await import('../controllers/internshipRecordControllers.js');

async function invoke(handler, user, expectedRows) {
  const originalExecute = db.execute;
  const calls = [];
  db.execute = async (sql, params = []) => {
    calls.push({ sql, params });
    return [expectedRows];
  };
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await handler({ verifiedUser: user }, response);
    return { calls, response };
  } finally {
    db.execute = originalExecute;
  }
}

test('past list counts documents per internship without multiplying rows or grouping', async () => {
  const rows = [{ id: 'record', company_name: 'Company', file_count: 3 }];
  const { calls, response } = await invoke(getMyPastInternshipRecords, { id: 'student' }, rows);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['student']);
  assert.match(calls[0].sql, /\(SELECT COUNT\(\*\) FROM internship_documents doc WHERE doc\.internship_id = ir\.id\) AS file_count/);
  assert.doesNotMatch(calls[0].sql, /LEFT JOIN internship_documents|GROUP BY/);
  assert.match(calls[0].sql, /ORDER BY ir\.date_ended DESC, ir\.created_at DESC/);
  assert.equal(response.statusCode, 200);
  assert.strictEqual(response.body, rows);
});

test('active and all lists keep their row shape and order while avoiding duplicate columns', async () => {
  const rows = [{ id: 'record', internship_position: 'Intern', description: 'Work' }];
  const active = await invoke(getAllActiveInternships, { id: 'admin', role: 'admin' }, rows);
  assert.equal(active.calls.length, 1);
  assert.match(active.calls[0].sql, /WHERE ir\.status = "ongoing"/);
  assert.strictEqual(active.response.body, rows);

  for (const role of ['student', 'admin', 'department_head']) {
    const result = await invoke(getAllUserInternships, { id: 'viewer', role }, rows);
    assert.equal(result.calls.length, 1);
    assert.strictEqual(result.response.body, rows);
    assert.match(result.calls[0].sql, /ORDER BY ir\.created_at DESC/);
    const projection = result.calls[0].sql.split(/\bFROM internship_records\b/)[0];
    assert.equal((projection.match(/ir\.internship_position/g) ?? []).length, 1);
    assert.equal((projection.match(/ir\.description/g) ?? []).length, 1);
    assert.deepEqual(result.calls[0].params, role === 'student' ? ['viewer'] : []);
  }
});
