import { db } from '../../../config/db.js';
import { reportError } from '../../../config/errorTracking.js';
import { headCriteriaDepartment } from '../../evaluation-criteria/criteriaDepartment.js';
import { buildCompanySummaries } from '../companySummaryModel.js';

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export async function getCompanySummary(req, res) {
  res.set('Cache-Control', 'private, no-store');
  const courseId = String(req.query.courseId ?? '');
  const from = String(req.query.from ?? '');
  const through = String(req.query.through ?? '');
  const sort = String(req.query.sort ?? 'highest');
  const page = Number(req.query.page ?? 1);
  const key = req.params.companyKey;
  if ((courseId && !/^[1-9]\d*$/.test(courseId)) ||
      (from && !validDate(from)) || (through && !validDate(through)) ||
      (from && through && from > through) ||
      !['highest', 'lowest'].includes(sort) || !Number.isSafeInteger(page) || page < 1 || page > 100000 ||
      (key && !/^[a-f0-9]{64}$/.test(key))) {
    return res.status(400).json({ error: 'Choose valid company evaluation filters.' });
  }

  let connection;
  try {
    connection = await db.getConnection();
    const departmentId = await headCriteriaDepartment(connection, req.verifiedUser.id);
    if (!departmentId) return res.status(403).json({ error: 'Company ratings are unavailable for this role.' });
    const [courses] = await connection.execute(
      'SELECT id, course_name, short_name FROM courses WHERE department_id = ? ORDER BY course_name',
      [departmentId],
    );
    if (courseId && !courses.some((course) => Number(course.id) === Number(courseId)))
      return res.status(403).json({ error: 'The selected course is outside your department.' });

    const conditions = [
      'm.deleted_at IS NULL', "ir.status IN ('ongoing', 'finished')", 'ir.deleted_at IS NULL',
      'u.deleted_at IS NULL', 'sai.id IS NOT NULL',
    ];
    const params = [];
    if (courseId) { conditions.push('sai.course_id = ?'); params.push(Number(courseId)); }
    if (from) { conditions.push('ir.date_started >= ?'); params.push(from); }
    if (through) { conditions.push('ir.date_started <= ?'); params.push(through); }

    const [rows] = await connection.execute(
      `SELECT m.id AS evaluation_id, m.internship_record_id, m.student_id, m.other_remarks,
         DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS submitted_at,
         ir.company_name, ir.company_address, sai.department_id,
         p.first_name, p.last_name, c.category, c.criterion_name, s.score
       FROM company_evaluation_masters m
       JOIN internship_records ir ON ir.id = m.internship_record_id
       JOIN users u ON u.id = m.student_id
       LEFT JOIN user_profiles p ON p.user_id = m.student_id
       LEFT JOIN student_academic_info sai ON sai.id = (
         SELECT MAX(latest.id) FROM student_academic_info latest WHERE latest.user_id = m.student_id
       )
       JOIN company_evaluation_scores s ON s.evaluation_master_id = m.id
       JOIN company_evaluation_criteria c ON c.id = s.criterion_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY m.id, s.id`,
      params,
    );
    const summaries = buildCompanySummaries(rows, departmentId);
    summaries.sort((a, b) => {
      const ratingOrder = sort === 'highest' ? b.rating - a.rating : a.rating - b.rating;
      return ratingOrder || a.companyName.localeCompare(b.companyName) || (a.companyAddress || '').localeCompare(b.companyAddress || '');
    });
    if (key) {
      const company = summaries.find((item) => item.key === key);
      return company ? res.json({ company, filters: { courseId, from, through }, courses }) : res.status(404).json({ error: 'Company not found in the selected period.' });
    }
    const pageSize = 10;
    const total = summaries.length;
    const withoutEvaluations = ({ evaluations, ...summary }) => summary;
    return res.json({
      companies: summaries.slice((page - 1) * pageSize, page * pageSize).map(withoutEvaluations),
      total, page, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      highest: summaries.length ? withoutEvaluations(sort === 'highest' ? summaries[0] : summaries[summaries.length - 1]) : null,
      lowest: summaries.length ? withoutEvaluations(sort === 'highest' ? summaries[summaries.length - 1] : summaries[0]) : null,
      courses,
      filters: { courseId, from, through, sort },
    });
  } catch (error) {
    reportError('Company evaluation summary failed:', error);
    return res.status(500).json({ error: 'Could not load company ratings.' });
  } finally {
    connection?.release();
  }
}
