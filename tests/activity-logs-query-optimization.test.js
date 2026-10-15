import { test } from 'node:test';
import assert from 'node:assert/strict';

const { db } = await import('../config/db.js');
const { getMyActivityLogs, getAllActivityLogs } = await import('../features/activity-logs/controllers/activityLogsControllers.js');

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

test('admin page returns filtered stats and 15-row pages with unfiltered filter menus', async () => {
  const options = [
    { filter_type: 'action', filter_value: 'created' },
    { filter_type: 'actor_role', filter_value: 'student' },
    { filter_type: 'target_type', filter_value: 'internship' },
  ];
  const { res, calls } = await invoke(getAllActivityLogs,
    { action: 'created', actorRole: 'student', targetType: 'internship', search: 'Acme', page: '2' },
    (_, __, call) => [
      [{ id: 8, actor_id: 'viewer', first_name: 'Ana', last_name: 'Reyes', action: 'created' }],
      options,
      [{ total_events: 61, active_users: 7 }],
      [{ name: 'created', event_count: 42 }],
      [{ name: 'internship', event_count: 38 }],
    ][call - 1]);
  const filters = ['created', 'student', 'internship', '%Acme%'];
  assert.equal(calls.length, 5);
  assert.deepEqual(calls[0].params, [...filters, 15, 15]);
  assert.match(calls[1].sql, /UNION ALL[\s\S]*ORDER BY filter_type ASC, filter_value ASC/);
  for (const call of calls.slice(2)) assert.deepEqual(call.params, filters);
  assert.match(calls[2].sql, /COUNT\(DISTINCT actor_id\)/);
  assert.deepEqual(res.body, { data: [{ id: 8, actor_id: 'viewer', actor_name: 'Ana Reyes', actor_role: undefined,
    action: 'created', target_type: undefined, target_id: undefined, description: undefined,
    metadata: undefined, created_at: undefined }],
    filters: { actions: ['created'], actorRoles: ['student'], targetTypes: ['internship'] },
    stats: { totalEvents: 61, activeUsers: 7, mostCommonAction: { name: 'created', count: 42 },
      mostActiveModule: { name: 'internship', count: 38 } },
    pagination: { page: 2, limit: 15, total: 61, totalPages: 5 } });
});

test('empty admin pages retain filtered totals; personal pages retain their count fallback', async () => {
  const mine = await invoke(getMyActivityLogs, { page: '9' }, (_, __, call) =>
    call === 2 ? [{ total: 6 }] : []);
  assert.equal(mine.calls.length, 2);
  assert.deepEqual(mine.res.body.pagination, { page: 9, limit: 10, total: 6, totalPages: 1 });

  const admin = await invoke(getAllActivityLogs, { page: '9' }, (_, __, call) =>
    call === 3 ? [{ total_events: 6, active_users: 3 }] : []);
  assert.equal(admin.calls.length, 5);
  assert.deepEqual(admin.res.body.pagination, { page: 9, limit: 15, total: 6, totalPages: 1 });
  assert.deepEqual(admin.res.body.stats, { totalEvents: 6, activeUsers: 3,
    mostCommonAction: null, mostActiveModule: null });
  assert.deepEqual(admin.res.body.filters, { actions: [], actorRoles: [], targetTypes: [] });

  const noMatches = await invoke(getAllActivityLogs, { action: 'missing' }, (_, __, call) =>
    call === 3 ? [{ total_events: 0, active_users: 0 }] : []);
  assert.deepEqual(noMatches.res.body.stats, { totalEvents: 0, activeUsers: 0,
    mostCommonAction: null, mostActiveModule: null });
  assert.deepEqual(noMatches.res.body.pagination, { page: 1, limit: 15, total: 0, totalPages: 0 });
});
