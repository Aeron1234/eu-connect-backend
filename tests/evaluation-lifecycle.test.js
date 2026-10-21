import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { db } from '../config/db.js';
import cache from '../config/cache/cache.js';
import { createStudentEvaluation, deleteStudentEvaluation, getPastStudentEvaluations, getAllStudentEvaluations, reviewDisputedEvaluation } from '../features/evaluations/controllers/studentEvaluationControllers.js';
import { createEmployerEvaluation, deleteEmployerEvaluation } from '../features/evaluations/controllers/employerEvaluationsController.js';
import { evaluationEligibilityHandler } from '../features/evaluations/evaluationLifecycle.js';
const original = db.getConnection;
beforeEach(() => cache.flushAll());
after(async () => { db.getConnection = original; cache.close(); await db.end(); });
const response = () => ({ statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const req = (role, id = 'author') => ({ verifiedUser: { id, role, department_id: 999 }, params: { evaluationId: 'evaluation', studentId: 'student' },
  body: { student_id: 'student', scores: Array.from({ length: 29 }, (_, n) => ({ criterion_name: 'Criterion ' + n, score: 4 })) }, app: { get() {} } });

test('both directions reject a second active evaluation before scores, logs or notifications are written', async () => {
  for (const [create, role] of [[createStudentEvaluation, 'employer'], [createEmployerEvaluation, 'student']]) {
    let writes = 0, rollback = 0, parentLocked = false;
    db.getConnection = async () => ({ release() {}, async beginTransaction() {}, async commit() { throw Error('must not commit'); }, async rollback() { rollback++; },
      async execute(sql) {
        if (sql.includes('FROM internship_records')) { assert.match(sql, /FOR UPDATE/); parentLocked = true; return [[{ id: 'record', employer_id: 'author', date_started: '2000-01-01' }]]; }
        if (/SELECT id FROM .*evaluation_masters/.test(sql)) { assert(parentLocked); assert.match(sql, /deleted_at IS NULL/); return [[{ id: 'existing' }]]; }
        writes++; return [{ affectedRows: 1 }];
      } });
    const res = response(); await create(req(role), res); assert.equal(res.statusCode, 409); assert.equal(writes, 0); assert.equal(rollback, 1);
  }
});

test('concurrent creates serialize on the internship lock so only one active evaluation is posted', async () => {
  for (const [create, role] of [[createStudentEvaluation, 'employer'], [createEmployerEvaluation, 'student']]) {
    let active = false, lock = Promise.resolve(), inserts = 0;
    db.getConnection = async () => {
      let unlock;
      return { release() {}, async beginTransaction() {}, async commit() { unlock?.(); }, async rollback() { unlock?.(); }, async execute(sql) {
        if (sql.includes('FROM internship_records')) {
          const previous = lock; lock = new Promise(resolve => { unlock = resolve; }); await previous;
          return [[{ id: 'record', employer_id: 'author', date_started: '2000-01-01', company_name: 'Company' }]];
        }
        if (/SELECT id FROM .*evaluation_masters/.test(sql)) return [active ? [{ id: 'existing' }] : []];
        if (/INSERT INTO (student|employer)_evaluation_masters/.test(sql)) { assert(!active); active = true; inserts++; }
        if (sql.includes('FROM user_profiles')) return [[{ first_name: 'Author', last_name: 'Name' }]];
        if (sql.includes('SELECT DISTINCT u.id')) return [[]];
        return [{ affectedRows: 1 }];
      } };
    };
    const first = response(), second = response(); await Promise.all([create(req(role), first), create(req(role), second)]);
    assert.deepEqual([first.statusCode, second.statusCode].sort(), [201, 409]); assert.equal(inserts, 1);
  }
});

test('authors soft-delete only their own evaluation and never delete scores; staff purge only deleted entries', async () => {
  for (const [remove, authorRole] of [[deleteStudentEvaluation, 'employer'], [deleteEmployerEvaluation, 'student']]) {
    for (const [role, deleted, allowed, status] of [[authorRole, false, true, 200], [authorRole, true, true, 404], [authorRole, false, false, 404], ['admin', false, true, 409], ['admin', true, true, 200], ['department_head', true, true, 200], ['department_head', true, false, 404]]) {
      const writes = []; let committed = false;
      db.getConnection = async () => ({ release() {}, async beginTransaction() {}, async commit() { committed = true; }, async rollback() {},
        async execute(sql, params) {
          if (sql.trim().startsWith('SELECT')) {
            assert.match(sql, /FOR UPDATE/);
            if (role === 'department_head') { assert.match(sql, /MAX\(latest_student.id\)/); assert.equal(params[1], 'author'); assert(!params.includes(999)); }
            if (role === authorRole) { assert.match(sql, /AND m\.(evaluated_by|student_id) = \?/); assert.equal(params[1], 'author'); }
            return [allowed ? [{ id: 'evaluation', deleted_at: deleted ? '2026-10-21' : null, internship_record_id: 'record', author_id: 'author', company_name: 'Company' }] : []];
          }
          writes.push(sql); return [{ affectedRows: 1 }];
        } });
      const res = response(); await remove(req(role), res); assert.equal(res.statusCode, status, role + JSON.stringify(res.body));
      assert.equal(committed, status === 200);
      if (status !== 200) assert.equal(writes.length, 0);
      else if (role === authorRole) { assert(writes.some(sql => /SET deleted_at = CURRENT_TIMESTAMP/.test(sql))); assert(!writes.some(sql => /DELETE FROM/.test(sql))); }
      else { assert(writes.some(sql => /DELETE FROM .*evaluation_scores/.test(sql))); assert(writes.some(sql => /DELETE FROM .*evaluation_masters.*deleted_at IS NOT NULL/.test(sql))); }
    }
  }
});

test('deletion commit failures preserve caches and do not claim success', async () => {
  cache.set('history', { path: '/api/v1/evaluations/all', body: [] });
  let rolledBack = false;
  db.getConnection = async () => ({ release() {}, async beginTransaction() {}, async commit() { throw Error('failed commit'); }, async rollback() { rolledBack = true; },
    async execute(sql) { return sql.trim().startsWith('SELECT') ? [[{ id: 'evaluation', deleted_at: null, company_name: 'Company' }]] : [{ affectedRows: 1 }]; } });
  const res = response(), log = console.error; console.error = () => {};
  try { await deleteStudentEvaluation(req('employer'), res); } finally { console.error = log; }
  assert.equal(res.statusCode, 500); assert(rolledBack); assert(cache.has('history'));
});

test('authors cannot read deleted summaries; staff history retains their deleted label and scores', async () => {
  for (const role of ['employer', 'admin', 'department_head']) {
    db.getConnection = async () => ({ release() {}, async execute(sql) {
      if (role === 'employer') { assert.match(sql, /m.deleted_at IS NULL/); return [[]]; }
      assert.doesNotMatch(sql, /AND m.deleted_at IS NULL/);
      return [[{ evaluation_id: 'deleted', deleted_at: '2026-10-21', submitted_date: '2026-10-20', breakdown_label: 'Quality', breakdown_score: 4 }]];
    } });
    const res = response(); await getPastStudentEvaluations(req(role), res);
    assert.equal(res.body.data.length, role === 'employer' ? 0 : 1);
    if (role !== 'employer') { assert.equal(res.body.data[0].status, 'Deleted'); assert.equal(res.body.data[0].breakdown[0].score, 4); }
  }
  db.getConnection = async () => ({ release() {}, async execute(sql) { assert.match(sql, /m.deleted_at IS NULL/); return [[]]; } });
  const history = response(); await getAllStudentEvaluations(req('student'), history); assert.deepEqual(history.body.data, []);
});

test('posting availability checks accepted supervision and active rather than deleted history', async () => {
  for (const direction of ['performance', 'supervisor']) for (const active of [false, true]) {
    db.getConnection = async () => ({ release() {}, async execute(sql, params) {
      assert.match(sql, /m.deleted_at IS NULL/); assert.match(sql, /ir.deleted_at IS NULL/);
      if (direction === 'performance') { assert.match(sql, /AND ir.employer_id = \?/); assert.deepEqual(params, ['student', 'author']); }
      return [[{ id: 'record', has_evaluation: Number(active) }]];
    } });
    const res = response(); await evaluationEligibilityHandler(direction)(req(direction === 'performance' ? 'employer' : 'student'), res);
    assert.equal(res.body.can_post, !active);
  }
});

test('legacy review is retired and migration preserves duplicates before enforcing one active slot', async () => {
  const review = response(); await reviewDisputedEvaluation(req('admin'), review); assert.equal(review.statusCode, 410);
  const sql = readFileSync(new URL('../scripts/2026-10-22-evaluation-soft-delete.sql', import.meta.url), 'utf8');
  assert.equal((sql.match(/ADD COLUMN IF NOT EXISTS deleted_at DATETIME/g) || []).length, 2);
  assert.equal((sql.match(/ROW_NUMBER\(\) OVER/g) || []).length, 2);
  assert.equal((sql.match(/ADD COLUMN IF NOT EXISTS active_evaluation TINYINT/g) || []).length, 2);
  assert.equal((sql.match(/CASE WHEN deleted_at IS NULL THEN 1 ELSE NULL END/g) || []).length, 2);
  assert.equal((sql.match(/ADD UNIQUE KEY IF NOT EXISTS uq_\w+ \(internship_record_id, active_evaluation\)/g) || []).length, 2);
  assert.doesNotMatch(sql, /GENERATED ALWAYS AS \([^\n]*internship_record_id/);
  assert.equal((sql.match(/DROP TEMPORARY TABLE IF EXISTS old_\w+_evaluations/g) || []).length, 2);
  assert.match(sql, /DROP COLUMN IF EXISTS status/); assert.doesNotMatch(sql, /DELETE FROM .*evaluation/);
});
