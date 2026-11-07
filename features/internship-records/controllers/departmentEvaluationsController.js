import { db } from "../../../config/db.js";
import { reportError } from "../../../config/errorTracking.js";

// The feed contains evaluation headers only. The record-detail endpoint still
// authorizes and loads scores, comments, printing, and permanent deletion.
export async function getDepartmentEvaluations(req, res) {
  res.set("Cache-Control", "private, no-store");
  const page = Number(req.query.page ?? 1);
  const type = String(req.query.type ?? "");
  const status = String(req.query.status ?? "");
  const search = String(req.query.search ?? "").trim().replace(/\s+/g, " ");
  const company = String(req.query.company ?? "").trim().replace(/\s+/g, " ");
  const courseId = String(req.query.courseId ?? "");
  const internshipId = String(req.query.internshipId ?? "");
  const evaluationId = String(req.query.evaluationId ?? "");
  const from = String(req.query.from ?? "");
  const through = String(req.query.through ?? "");
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 ||
      !["", "performance", "supervisor"].includes(type) ||
      !["", "active", "deleted"].includes(status) || search.length > 100 || company.length > 100 ||
      (courseId && !/^\d+$/.test(courseId)) ||
      (internshipId && !/^[\w-]{1,64}$/.test(internshipId)) ||
      (evaluationId && !/^[\w-]{1,64}$/.test(evaluationId)) ||
      [from, through].some(date => date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) ||
      (from && through && from > through))
    return res.status(400).json({ error: "Invalid evaluation filters." });

  let connection;
  try {
    connection = await db.getConnection();
    const [[head]] = await connection.execute(
      `SELECT h.department_id, d.code FROM dept_heads_background_info h
       JOIN departments d ON d.id = h.department_id WHERE h.user_id = ? LIMIT 1`,
      [req.verifiedUser.id],
    );
    if (!head?.department_id || head.code === "REG")
      return res.status(403).json({ error: "Evaluation review is unavailable for this role." });
    const [courses] = await connection.execute(
      `SELECT id, course_name, short_name FROM courses WHERE department_id = ? ORDER BY course_name`,
      [head.department_id],
    );
    const items = `(SELECT id, internship_record_id, evaluated_by AS author_id,
        'performance' AS type, created_at, deleted_at FROM student_evaluation_masters
      UNION ALL SELECT id, internship_record_id, student_id AS author_id,
        'supervisor' AS type, created_at, deleted_at FROM employer_evaluation_masters)`;
    const joins = `FROM ${items} e
      JOIN internship_records ir ON ir.id = e.internship_record_id AND ir.deleted_at IS NULL
      JOIN users u ON u.id = ir.user_id AND u.deleted_at IS NULL
      LEFT JOIN user_profiles p ON p.user_id = ir.user_id
      LEFT JOIN user_profiles author_profile ON author_profile.user_id = e.author_id
      JOIN student_academic_info sai ON sai.id = (
        SELECT MAX(latest.id) FROM student_academic_info latest WHERE latest.user_id = ir.user_id
      )`;
    const conditions = ["sai.department_id = ?"];
    const params = [head.department_id];
    if (type) { conditions.push("e.type = ?"); params.push(type); }
    if (status) conditions.push(status === "deleted" ? "e.deleted_at IS NOT NULL" : "e.deleted_at IS NULL");
    if (search) { conditions.push("LOWER(CONCAT_WS(' ', p.first_name, p.last_name)) LIKE ?"); params.push(`%${search.toLowerCase()}%`); }
    if (company) { conditions.push("LOWER(ir.company_name) LIKE ?"); params.push(`%${company.toLowerCase()}%`); }
    if (courseId) { conditions.push("sai.course_id = ?"); params.push(Number(courseId)); }
    if (internshipId) { conditions.push("ir.id = ?"); params.push(internshipId); }
    if (evaluationId) { conditions.push("e.id = ?"); params.push(evaluationId); }
    if (from) { conditions.push("DATE(e.created_at) >= ?"); params.push(from); }
    if (through) { conditions.push("DATE(e.created_at) <= ?"); params.push(through); }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const [[count]] = await connection.execute(`SELECT COUNT(*) AS total ${joins} ${where}`, params);
    const pageSize = 10;
    const [rows] = await connection.execute(
      `SELECT e.id, e.internship_record_id AS internship_id, e.type,
         DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i:%s') AS submitted_at,
         DATE_FORMAT(e.deleted_at, '%Y-%m-%d %H:%i:%s') AS deleted_at,
         ir.user_id AS student_id, ir.company_name,
         CONCAT_WS(' ', p.first_name, p.last_name) AS student_name,
         CONCAT_WS(' ', author_profile.first_name, author_profile.last_name) AS author_name,
         c.course_name, c.short_name AS course_short_name
       ${joins} LEFT JOIN courses c ON c.id = sai.course_id ${where}
       ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    const total = Number(count.total) || 0;
    return res.json({ rows, courses, page, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) {
    reportError("Department evaluations read failed:", error);
    return res.status(500).json({ error: "Could not load department evaluations." });
  } finally {
    connection?.release();
  }
}
