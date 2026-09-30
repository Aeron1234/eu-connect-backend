import { test } from 'node:test';
import assert from 'node:assert/strict';

const { db } = await import('../config/db.js');
const { getAllNotifications } = await import('../controllers/notificationControllers.js');

async function invoke(query, rows, totals) {
  const original = db.getConnection;
  const calls = [];
  let releases = 0;
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(sql, params) {
      calls.push({ sql, params });
      return [calls.length === 1 ? rows : [totals]];
    },
  });
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  try {
    await getAllNotifications({ verifiedUser: { id: 'recipient' }, query }, res);
    return { res, calls, releases };
  } finally {
    db.getConnection = original;
  }
}

test('inbox total follows scope while unread badge remains global', async () => {
  const totals = { all_total: 9, request_total: 3, unread_count: 4 };
  const row = { notification_id: 'n', type: 'supervisor_request_submitted',
    sender_id: 'sender', sender_first_name: 'Ana', sender_last_name: 'Reyes',
    supervisor_request_status: 'pending', is_read: 0 };
  for (const [scope, expectedTotal] of [['all', 9], ['requests', 3]]) {
    const { res, calls, releases } = await invoke({ scope, page: '2', limit: '2' }, [row], totals);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].params, ['recipient', 2, 2]);
    assert.deepEqual(calls[1].params, ['recipient']);
    assert.match(calls[1].sql, /COUNT\(CASE WHEN type = 'supervisor_request_submitted' THEN 1 END\) AS request_total/);
    assert.match(calls[1].sql, /COUNT\(CASE WHEN is_read = 0 THEN 1 END\) AS unread_count/);
    assert.equal(res.body.totalRecords, expectedTotal);
    assert.equal(res.body.totalPages, Math.ceil(expectedTotal / 2));
    assert.equal(res.body.unreadCount, 4);
    assert.equal(res.body.data[0].actionable, true);
    assert.equal(releases, 1);
  }
});

test('empty and out-of-range inbox pages still return counts and at least one page', async () => {
  const later = await invoke({ scope: 'requests', page: '99', limit: '2' }, [],
    { all_total: 9, request_total: 3, unread_count: 4 });
  assert.equal(later.calls.length, 2);
  assert.deepEqual(later.res.body, { data: [], unreadCount: 4,
    totalPages: 2, totalRecords: 3, currentPage: 99, scope: 'requests' });

  const empty = await invoke({}, [], { all_total: 0, request_total: 0, unread_count: 0 });
  assert.equal(empty.calls.length, 2);
  assert.deepEqual(empty.res.body, { data: [], unreadCount: 0,
    totalPages: 1, totalRecords: 0, currentPage: 1, scope: 'all' });
});
