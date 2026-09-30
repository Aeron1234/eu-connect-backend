import { test } from 'node:test';
import assert from 'node:assert/strict';

const { db } = await import('../config/db.js');
const { getMyActivityLogs, getAllActivityLogs } = await import('../controllers/activityLogsControllers.js');

async function invoke(handler, query, answer) {
  const original = db.getConnection;
  const calls = [];
  let releases = 0;
  db.getConnection = async () => ({
    release() { releases++; },
    async execute(sql, params = []) {
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
    await handler({ verifiedUser: { id: 'viewer', role: 'admin' }, query }, res);
    return { res, calls, releases };
  } finally {
    db.getConnection = original;
  }
}

test('personal page carries its count without exposing the SQL alias', async () => {
  const { res, calls, releases } = await invoke(getMyActivityLogs, { page: '2' }, () =>
    [{ id: 8, action: 'created', total_logs: 17 }]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['viewer', 'viewer', 10, 10]);
  assert.deepEqual(res.body, { data: [{ id: 8, action: 'created' }],
    pagination: { page: 2, limit: 10, total: 17, totalPages: 2 } });
  assert.equal(releases, 1);
});

test('admin page preserves filtered totals and unfiltered filter menus in two reads', async () => {
  const options = [
    { filter_type: 'action', filter_value: 'created' },
    { filter_type: 'actor_role', filter_value: 'student' },
    { filter_type: 'target_type', filter_value: 'internship' },
  ];
  const { res, calls } = await invoke(getAllActivityLogs,
    { action: 'created', actorRole: 'student', targetType: 'internship', search: 'Acme', page: '2' },
    (_, __, call) => call === 1 ? [{ id: 8, actor_id: 'viewer', first_name: 'Ana', last_name: 'Reyes',
      action: 'created', total_logs: 61 }] : options);
  const filters = ['created', 'student', 'internship', '%Acme%'];
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, [...filters, ...filters, 50, 50]);
  assert.match(calls[1].sql, /UNION ALL[\s\S]*ORDER BY filter_type ASC, filter_value ASC/);
  assert.deepEqual(res.body, { data: [{ id: 8, actor_id: 'viewer', actor_name: 'Ana Reyes', actor_role: undefined,
    action: 'created', target_type: undefined, target_id: undefined, description: undefined,
    metadata: undefined, created_at: undefined }],
    filters: { actions: ['created'], actorRoles: ['student'], targetTypes: ['internship'] },
    pagination: { page: 2, limit: 50, total: 61, totalPages: 2 } });
});

test('empty admin and personal pages retain their count fallback', async () => {
  const mine = await invoke(getMyActivityLogs, { page: '9' }, (_, __, call) =>
    call === 2 ? [{ total: 6 }] : []);
  assert.equal(mine.calls.length, 2);
  assert.deepEqual(mine.res.body.pagination, { page: 9, limit: 10, total: 6, totalPages: 1 });

  const admin = await invoke(getAllActivityLogs, { page: '1' }, (_, __, call) =>
    call === 2 ? [{ total: 6 }] : []);
  assert.equal(admin.calls.length, 3);
  assert.deepEqual(admin.res.body.pagination, { page: 1, limit: 50, total: 6, totalPages: 1 });
  assert.deepEqual(admin.res.body.filters, { actions: [], actorRoles: [], targetTypes: [] });
});
