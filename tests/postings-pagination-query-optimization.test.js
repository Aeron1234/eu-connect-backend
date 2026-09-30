import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_KEY = 'no-network';

const { db } = await import('../config/db.js');
const { getInternshipPostings } = await import('../controllers/internshipPostsControllers.js');
const { getPostedJobs } = await import('../controllers/dashboardController.js');

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
    await handler({ verifiedUser: { id: 'viewer', role: 'employer' }, query }, res);
    return { res, calls, releases };
  } finally {
    db.getConnection = original;
  }
}

test('postings return an exact filtered total with no extra count query on populated pages', async () => {
  const result = await invoke(getInternshipPostings, { search: 'Acme', page: '2', limit: '5' }, sql => {
    if (sql.includes('JOIN courses')) return [{ posting_id: 'p', course_id: 1, course_name: 'IT', short_name: 'IT' }];
    return [{ id: 'p', employer_id: 'viewer', position: 'Intern', favorite_for_requester: 0, total_postings: 12 }];
  });
  assert.equal(result.res.statusCode, 200);
  assert.deepEqual(result.res.body.pagination, { page: 2, limit: 5, total: 12, totalPages: 3 });
  assert.deepEqual(result.res.body.data, [{ id: 'p', employer_id: 'viewer', position: 'Intern', isOwner: true, isFavorited: false,
    courses: [{ id: 1, name: 'IT', shortName: 'IT' }] }]);
  assert.equal(result.calls.length, 2);
  assert.deepEqual(result.calls[0].params, ['viewer', '%Acme%', '%Acme%', '%Acme%', '%Acme%', 5, 5]);
  assert.equal(result.releases, 1);
});

test('postings preserve totals for empty first and out-of-range pages', async () => {
  const first = await invoke(getInternshipPostings, { page: '1' }, () => []);
  assert.equal(first.calls.length, 1);
  assert.deepEqual(first.res.body.pagination, { page: 1, limit: 10, total: 0, totalPages: 0 });
  const later = await invoke(getInternshipPostings, { page: '9' }, sql =>
    sql.trim().startsWith('SELECT COUNT(*) AS total') ? [{ total: 12 }] : []);
  assert.equal(later.calls.length, 2);
  assert.deepEqual(later.res.body.pagination, { page: 9, limit: 10, total: 12, totalPages: 2 });
  assert.deepEqual(later.res.body.data, []);
});

test('posted jobs keep job fields and total records on populated and empty pages', async () => {
  const filled = await invoke(getPostedJobs, { page: '2' }, () =>
    [{ id: 'p', position: 'Intern', total_records: 12 }]);
  assert.equal(filled.calls.length, 1);
  assert.deepEqual(filled.calls[0].params, ['viewer', 'viewer', 5, 5]);
  assert.deepEqual(filled.res.body, { jobs: [{ id: 'p', position: 'Intern' }], totalPages: 3, totalRecords: 12, currentPage: 2 });

  const first = await invoke(getPostedJobs, {}, () => []);
  assert.equal(first.calls.length, 1);
  assert.deepEqual(first.res.body, { jobs: [], totalPages: 0, totalRecords: 0, currentPage: 1 });

  const later = await invoke(getPostedJobs, { page: '9' }, sql =>
    sql.trim().startsWith('SELECT COUNT(*) AS total') ? [{ total: 12 }] : []);
  assert.equal(later.calls.length, 2);
  assert.deepEqual(later.res.body, { jobs: [], totalPages: 3, totalRecords: 12, currentPage: 9 });
});
