import { test } from 'node:test';
import assert from 'node:assert/strict';

const { db } = await import('../config/db.js');
const { getAllAnnouncements } = await import('../features/announcements/controllers/announcementControllers.js');

async function invoke(query, answer) {
  const original = db.execute;
  const calls = [];
  db.execute = async (sql, params) => {
    calls.push({ sql, params });
    return [answer(sql, params, calls.length)];
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await getAllAnnouncements({ verifiedUser: { id: 'viewer', role: 'student', department_id: 7 }, query }, res);
    return { res, calls };
  } finally {
    db.execute = original;
  }
}

test('populated history page carries the original regular count and hides its SQL alias', async () => {
  const pinned = [{ id: 1, title: 'Pinned' }];
  const regular = [{ id: 2, title: 'Regular', total_regular: 12 }];
  const { res, calls } = await invoke({ category: 'Department', search: 'Intern', page: '2' }, (_, __, call) =>
    call === 1 ? pinned : regular);
  assert.equal(calls.length, 2);
  const filters = ['Department', '%Intern%', '%Intern%', 'student', 'student', 7, 'viewer'];
  assert.deepEqual(calls[0].params, filters);
  assert.deepEqual(calls[1].params, [...filters, ...filters, 10, 10]);
  assert.match(calls[1].sql, /\(\s*SELECT COUNT\(\*\) AS total[\s\S]*\) AS total_regular/);
  assert.match(calls[1].sql, /authorDept\.department_id = \?/);
  assert.match(calls[0].sql, /DATE_FORMAT\(a\.event_date, '%Y-%m-%d'\) AS event_date/);
  assert.match(calls[1].sql, /DATE_FORMAT\(a\.event_date, '%Y-%m-%d'\) AS event_date/);
  assert.deepEqual(res.body, { pinned, regular: [{ id: 2, title: 'Regular' }],
    totalPages: 2, totalRecords: 12, currentPage: 2, currentRegularCount: 1 });
});

test('empty history page retains count semantics even on page one', async () => {
  const { res, calls } = await invoke({}, (_, __, call) =>
    call === 3 ? [{ total: 4 }] : []);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].params, ['student', 'student', 7, 'viewer']);
  assert.doesNotMatch(calls[2].sql, /INNER JOIN users|INNER JOIN user_profiles/);
  assert.deepEqual(res.body, { pinned: [], regular: [], totalPages: 1,
    totalRecords: 4, currentPage: 1, currentRegularCount: 0 });
});
