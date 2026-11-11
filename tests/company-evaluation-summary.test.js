import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompanySummaries } from '../features/evaluations/companySummaryModel.js';

const row = (changes = {}) => ({
  evaluation_id: 'e1', internship_record_id: 'i1', student_id: 's1',
  first_name: 'Juan', last_name: 'Dela Cruz', department_id: 1,
  company_name: 'ABC Hospital', company_address: 'North Branch',
  category: 'Workplace', criterion_name: 'Support', score: 5,
  submitted_at: '2026-11-11 09:00:00', other_remarks: 'Helpful team',
  ...changes,
});

test('repeated evaluations are averaged per student before the company rating', () => {
  const companies = buildCompanySummaries([
    row(), row({ evaluation_id: 'e2', score: 1 }),
    row({ evaluation_id: 'e3', student_id: 's2', first_name: 'Maria', last_name: 'Santos', department_id: 2, score: 5, other_remarks: 'Private detail' }),
  ], 1);
  assert.equal(companies.length, 1);
  assert.equal(companies[0].rating, 4); // Juan: (5+1)/2=3; Maria: 5; company: (3+5)/2=4.
  assert.equal(companies[0].reviewerCount, 2);
  assert.equal(companies[0].evaluationCount, 3);
  assert.equal(companies[0].categories[0].rating, 4);
  const outsider = companies[0].evaluations.find((evaluation) => !evaluation.ownDepartment);
  assert.equal(outsider.studentName, 'M••• S•••');
  assert.equal(outsider.remarks, null);
  assert.equal(companies[0].evaluations.find((evaluation) => evaluation.ownDepartment).remarks, 'Helpful team');
});

test('same-name branches and missing-address records remain separate', () => {
  const companies = buildCompanySummaries([
    row(),
    row({ evaluation_id: 'e2', internship_record_id: 'i2', company_address: 'South Branch' }),
    row({ evaluation_id: 'e3', internship_record_id: 'i3', company_address: '' }),
    row({ evaluation_id: 'e4', internship_record_id: 'i4', company_address: '' }),
  ], 1);
  assert.equal(companies.length, 4);
  assert.ok(companies.every((company) => company.uncertainMatch));
});
