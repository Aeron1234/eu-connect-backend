import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_KEY = 'no-network';

const { db } = await import('../config/db.js');
const { getAllDTRs } = await import('../features/dtr/controllers/dtrControllers.js');
const { getSearchedStudentDTRs } = await import('../features/users/controllers/searchedUserController.js');

async function invoke(handler, query, answer) {
  const original = db.getConnection;
  const calls = [];
  let releases = 0;
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(sql, params) {
      calls.push({ sql, params });
      return [answer(sql, params, calls.length)];
    },
  });
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await handler({ verifiedUser: { id: 'viewer' }, params: { studentId: 'student' }, query }, res);
    return { res, calls, releases };
  } finally {
    db.getConnection = original;
  }
}

test('personal history carries its total without changing SELECT-star response fields', async () => {
  const row = { id: 1, clock_in: '08:00', total_dtrs: 8 };
  const { res, calls, releases } = await invoke(getAllDTRs,
    { internshipId: 'internship', limit: '5', offset: '5' }, () => [row]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['viewer', 'internship', 'viewer', 'internship', 5, 5]);
  assert.match(calls[0].sql, /SELECT dtr\.\*,[\s\S]*AS total_dtrs/);
  assert.deepEqual(res.body, { dtrs: [{ id: 1, clock_in: '08:00' }],
    totalPages: 2, totalRecords: 8, currentPage: 2 });
  assert.equal(releases, 1);
});

test('searched-student history keeps ongoing, non-deleted internship count', async () => {
  const row = { id: 2, internship_id: 'internship', total_dtrs: 8 };
  const { res, calls } = await invoke(getSearchedStudentDTRs,
    { limit: '5', offset: '5' }, () => [row]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['student', 'student', 5, 5]);
  assert.match(calls[0].sql, /countedIr\.status = 'ongoing'[\s\S]*countedIr\.deleted_at IS NULL/);
  assert.deepEqual(res.body, { success: true, dtrs: [{ id: 2, internship_id: 'internship' }],
    totalPages: 2, totalRecords: 8, currentPage: 2 });
});

test('empty personal and searched pages keep their separate count fallback', async () => {
  for (const [handler, query, expectedParams] of [
    [getAllDTRs, { internshipId: 'internship', offset: '100' }, ['viewer', 'internship']],
    [getSearchedStudentDTRs, { offset: '100' }, ['student']],
  ]) {
    const { res, calls } = await invoke(handler, query, (_, __, call) =>
      call === 2 ? [{ total: 8 }] : []);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].params, expectedParams);
    assert.deepEqual(res.body.dtrs, []);
    assert.equal(res.body.totalRecords, 8);
    assert.equal(res.body.totalPages, 2);
  }
});
