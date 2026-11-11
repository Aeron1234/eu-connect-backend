import { createHash } from 'node:crypto';

const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const rounded = (value) => value == null ? null : Math.round(value * 100) / 100;

export function maskStudentName(firstName, lastName) {
  const mask = (part) => clean(part).split(' ').filter(Boolean).map((word) => `${word[0].toUpperCase()}•••`).join(' ');
  return [mask(firstName), mask(lastName)].filter(Boolean).join(' ') || 'Student';
}

// Keep missing-address records separate: the company name alone cannot identify a branch.
export function companyKey(row) {
  const name = clean(row.company_name).toLocaleLowerCase();
  const address = clean(row.company_address).toLocaleLowerCase();
  const identity = address ? `${name}\u0000${address}` : `${name}\u0000missing:${row.internship_record_id}`;
  return createHash('sha256').update(identity).digest('hex');
}

export function buildCompanySummaries(rows, headDepartmentId) {
  const companies = new Map();
  const addressesByName = new Map();
  for (const row of rows) {
    const name = clean(row.company_name);
    if (!name || row.score == null) continue;
    const normalizedName = name.toLocaleLowerCase();
    const address = clean(row.company_address);
    if (!addressesByName.has(normalizedName)) addressesByName.set(normalizedName, new Set());
    addressesByName.get(normalizedName).add(address.toLocaleLowerCase());
    const key = companyKey(row);
    if (!companies.has(key)) companies.set(key, { key, name, address, normalizedName, evaluations: new Map() });
    const company = companies.get(key);
    if (!company.evaluations.has(row.evaluation_id)) company.evaluations.set(row.evaluation_id, {
      id: row.evaluation_id,
      studentId: row.student_id,
      studentName: clean([row.first_name, row.last_name].filter(Boolean).join(' ')) || 'Student',
      maskedName: maskStudentName(row.first_name, row.last_name),
      ownDepartment: Number(row.department_id) === Number(headDepartmentId),
      remarks: row.other_remarks,
      submittedAt: row.submitted_at,
      scores: [],
    });
    company.evaluations.get(row.evaluation_id).scores.push({ category: clean(row.category) || 'Other', criterion: row.criterion_name, score: Number(row.score) });
  }

  return [...companies.values()].map((company) => {
    const evaluations = [...company.evaluations.values()];
    const students = new Map();
    for (const evaluation of evaluations) {
      if (!students.has(evaluation.studentId)) students.set(evaluation.studentId, { evaluations: [], categoryRatings: new Map() });
      const student = students.get(evaluation.studentId);
      const overall = average(evaluation.scores.map((item) => item.score));
      const categories = new Map();
      for (const score of evaluation.scores) {
        if (!categories.has(score.category)) categories.set(score.category, []);
        categories.get(score.category).push(score.score);
      }
      student.evaluations.push(overall);
      for (const [category, values] of categories) {
        if (!student.categoryRatings.has(category)) student.categoryRatings.set(category, []);
        student.categoryRatings.get(category).push(average(values));
      }
    }
    const categoryNames = new Set([...students.values()].flatMap((student) => [...student.categoryRatings.keys()]));
    const categories = [...categoryNames].sort().map((category) => ({
      category,
      rating: rounded(average([...students.values()].filter((student) => student.categoryRatings.has(category)).map((student) => average(student.categoryRatings.get(category))))),
    }));
    return {
      key: company.key,
      companyName: company.name,
      companyAddress: company.address || null,
      rating: rounded(average([...students.values()].map((student) => average(student.evaluations)))),
      reviewerCount: students.size,
      evaluationCount: evaluations.length,
      limitedFeedback: students.size < 3,
      uncertainMatch: !company.address ? 'Address missing; kept separate by internship record.' : addressesByName.get(company.normalizedName).size > 1 ? 'Same company name appears at multiple addresses; branches are kept separate.' : null,
      categories,
      evaluations: evaluations.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt))).map((evaluation) => ({
        id: evaluation.id,
        studentName: evaluation.ownDepartment ? evaluation.studentName : evaluation.maskedName,
        ownDepartment: evaluation.ownDepartment,
        remarks: evaluation.ownDepartment ? evaluation.remarks : null,
        submittedAt: evaluation.submittedAt,
        rating: rounded(average(evaluation.scores.map((score) => score.score))),
        studentAverage: rounded(average(students.get(evaluation.studentId).evaluations)),
        scores: evaluation.scores.map((score) => ({ category: score.category, criterion: score.criterion, score: score.score })),
      })),
    };
  });
}
