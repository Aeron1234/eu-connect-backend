import { db } from "../../../config/db.js";
import { reportError } from "../../../config/errorTracking.js";

// One scoped, paginated feed replaces per-internship fan-out. The underlying
// detail endpoints still authorize each document and report independently.
export async function getDepartmentSubmissions(req, res) {
  res.set("Cache-Control", "private, no-store");
  const page = Number(req.query.page ?? 1);
  const type = String(req.query.type ?? "");
  const search = String(req.query.search ?? "").trim().replace(/\s+/g, " ");
  const company = String(req.query.company ?? "").trim().replace(/\s+/g, " ");
  const courseId = String(req.query.courseId ?? "");
  const internshipId = String(req.query.internshipId ?? "");
  const from = String(req.query.from ?? "");
  const through = String(req.query.through ?? "");
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 ||
      !["", "narrative", "report", "document"].includes(type) || search.length > 100 || company.length > 100 ||
      (courseId && !/^\d+$/.test(courseId)) ||
      (internshipId && !/^[\w-]{1,64}$/.test(internshipId)) ||
      [from, through].some(date => date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) ||
      (from && through && from > through))
    return res.status(400).json({ error: "Invalid submission filters." });

  let connection;
  try {
    connection = await db.getConnection();
    const [[head]] = await connection.execute(
      `SELECT h.department_id, d.code FROM dept_heads_background_info h
       JOIN departments d ON d.id = h.department_id WHERE h.user_id = ? LIMIT 1`,
      [req.verifiedUser.id],
    );
    if (!head?.department_id || head.code === "REG")
      return res.status(403).json({ error: "Student submissions are unavailable for this role." });
    const [courses] = await connection.execute(
      `SELECT id, course_name, short_name FROM courses WHERE department_id = ? ORDER BY course_name`,
      [head.department_id],
    );
    const items = `(SELECT id, internship_id, user_id, 'narrative' AS type, title AS title, created_at FROM weekly_narratives
      UNION ALL SELECT id, internship_id, user_id, 'report', 'Summary report', created_at FROM summary_reports
      UNION ALL SELECT id, internship_id, user_id, 'document', file_name, created_at FROM internship_documents
        WHERE uploaded_by_role IS NULL OR uploaded_by_role = 'student')`;
    const joins = `FROM ${items} s
      JOIN internship_records ir ON ir.id = s.internship_id AND ir.user_id = s.user_id AND ir.deleted_at IS NULL
      JOIN users u ON u.id = ir.user_id AND u.deleted_at IS NULL
      LEFT JOIN user_profiles p ON p.user_id = ir.user_id
      JOIN student_academic_info sai ON sai.id = (
        SELECT MAX(latest.id) FROM student_academic_info latest WHERE latest.user_id = ir.user_id
      )`;
    const conditions = ["sai.department_id = ?"];
    const params = [head.department_id];
    if (type) { conditions.push("s.type = ?"); params.push(type); }
    if (search) { conditions.push("LOWER(CONCAT_WS(' ', p.first_name, p.last_name)) LIKE ?"); params.push(`%${search.toLowerCase()}%`); }
    if (company) { conditions.push("LOWER(ir.company_name) LIKE ?"); params.push(`%${company.toLowerCase()}%`); }
    if (courseId) { conditions.push("sai.course_id = ?"); params.push(Number(courseId)); }
    if (internshipId) { conditions.push("ir.id = ?"); params.push(internshipId); }
    if (from) { conditions.push("DATE(s.created_at) >= ?"); params.push(from); }
    if (through) { conditions.push("DATE(s.created_at) <= ?"); params.push(through); }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const [[summary]] = await connection.execute(`SELECT COUNT(*) AS total ${joins} ${where}`, params);
    const pageSize = 10;
    const [rows] = await connection.execute(
      `SELECT s.id, s.internship_id, s.type, s.title,
         DATE_FORMAT(s.created_at, '%Y-%m-%d %H:%i:%s') AS submitted_at,
         ir.user_id AS student_id, ir.company_name,
         CONCAT_WS(' ', p.first_name, p.last_name) AS student_name,
         c.course_name, c.short_name AS course_short_name
       ${joins} LEFT JOIN courses c ON c.id = sai.course_id ${where}
       ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    const total = Number(summary.total) || 0;
    return res.json({ rows, courses, page, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) {
    reportError("Department submissions read failed:", error);
    return res.status(500).json({ error: "Could not load student submissions." });
  } finally {
    connection?.release();
  }
}
