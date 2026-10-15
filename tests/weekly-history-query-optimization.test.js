import { test } from 'node:test';
import assert from 'node:assert/strict';

const { db } = await import('../config/db.js');
const { getAllWeeklyNarratives, getSearchedStudentWeeklyNarratives } = await import('../features/weekly-narratives/controllers/weeklyNarrativeControllers.js');

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
    await handler({ verifiedUser: { id: 'student' }, params: { searchedUserId: 'student' }, query }, res);
    return { res, calls, releases };
  } finally {
    db.getConnection = original;
  }
}

test('personal weekly page carries aggregate statistics and strips internal columns', async () => {
  const { res, calls, releases } = await invoke(getAllWeeklyNarratives,
    { internshipId: 'internship', page: '2', limit: '5' }, () => [{
      id: 1, week_number: 2, title: 'Week 2',
      total_entries: '8', latest_week: '8', total_words: '350', entries_this_week: '1',
    }]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['student', 'internship', 'student', 'internship', 5, 5]);
  assert.match(calls[0].sql, /CROSS JOIN \([\s\S]*CHAR_LENGTH\(TRIM\(narrative\)\)[\s\S]*YEARWEEK\(created_at, 1\)/);
  assert.deepEqual(res.body, { success: true, narratives: [{ id: 1, week_number: 2, title: 'Week 2' }],
    stats: { totalEntries: 8, latestWeek: 8, totalWords: 350, thisWeek: 1 },
    totalPages: 2, totalRecords: 8, currentPage: 2 });
  assert.equal(releases, 1);
});

test('searched-student weekly page carries the ongoing-internship total', async () => {
  const { res, calls } = await invoke(getSearchedStudentWeeklyNarratives,
    { page: '2', limit: '5' }, () => [{ id: 1, week_number: 2, total_narratives: '8' }]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['student', 'student', 5, 5]);
  assert.match(calls[0].sql, /countedIr\.status = 'ongoing'[\s\S]*countedIr\.deleted_at IS NULL/);
  assert.deepEqual(res.body, { success: true, narratives: [{ id: 1, week_number: 2 }],
    totalPages: 2, totalRecords: 8, currentPage: 2 });
});

test('empty weekly pages keep their original stats and count fallbacks', async () => {
  const personal = await invoke(getAllWeeklyNarratives,
    { internshipId: 'internship', page: '99' }, (_, __, call) =>
      call === 2 ? [{ total_entries: 8, latest_week: 8, total_words: 350, entries_this_week: 1 }] : []);
  assert.equal(personal.calls.length, 2);
  assert.deepEqual(personal.calls[1].params, ['student', 'internship']);
  assert.deepEqual(personal.res.body.narratives, []);
  assert.deepEqual(personal.res.body.stats, { totalEntries: 8, latestWeek: 8, totalWords: 350, thisWeek: 1 });

  const searched = await invoke(getSearchedStudentWeeklyNarratives, { page: '99' }, (_, __, call) =>
    call === 2 ? [{ total: 8 }] : []);
  assert.equal(searched.calls.length, 2);
  assert.deepEqual(searched.calls[1].params, ['student']);
  assert.deepEqual(searched.res.body.narratives, []);
  assert.equal(searched.res.body.totalRecords, 8);
});
