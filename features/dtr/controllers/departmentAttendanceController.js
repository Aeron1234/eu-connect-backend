import { db } from "../../../config/db.js";
import { reportError } from "../../../config/errorTracking.js";

// Every query derives the head's current department from the database. The
// latest academic row determines student membership, as on Records and photos.
export async function getDepartmentAttendance(req, res) {
  res.set("Cache-Control", "private, no-store");
  const page = Number(req.query.page ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000)
    return res.status(400).json({ error: "Invalid page." });
  const search = String(req.query.search ?? "").trim().replace(/\s+/g, " ");
  const company = String(req.query.company ?? "").trim().replace(/\s+/g, " ");
  const courseId = String(req.query.courseId ?? "").trim();
  const internshipId = String(req.query.internshipId ?? "").trim();
  const from = String(req.query.from ?? "").trim();
  const through = String(req.query.through ?? "").trim();
  if (search.length > 100 || company.length > 100 || (courseId && !/^\d+$/.test(courseId)) ||
      (internshipId && !/^[\w-]{1,64}$/.test(internshipId)) ||
      [from, through].some(date => date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) ||
      (from && through && from > through))
    return res.status(400).json({ error: "Invalid attendance filters." });

  let connection;
  try {
    connection = await db.getConnection();
    const [[head]] = await connection.execute(
      `SELECT h.department_id, d.code FROM dept_heads_background_info h
       JOIN departments d ON d.id = h.department_id WHERE h.user_id = ? LIMIT 1`,
      [req.verifiedUser.id],
    );
    if (!head?.department_id || head.code === "REG")
      return res.status(403).json({ error: "Attendance review is unavailable for this role." });
    const [courses] = await connection.execute(
      `SELECT id, course_name, short_name FROM courses WHERE department_id = ? ORDER BY course_name`,
      [head.department_id],
    );
    const fromSql = `FROM daily_time_records dtr
      JOIN internship_records ir ON ir.id = dtr.internship_id AND ir.deleted_at IS NULL
      JOIN users u ON u.id = ir.user_id AND u.deleted_at IS NULL
      LEFT JOIN user_profiles p ON p.user_id = ir.user_id
      JOIN student_academic_info sai ON sai.id = (
        SELECT MAX(latest.id) FROM student_academic_info latest WHERE latest.user_id = ir.user_id
      )`;
    const conditions = ["sai.department_id = ?"];
    const params = [head.department_id];
    if (search) {
      conditions.push("LOWER(CONCAT_WS(' ', p.first_name, p.last_name)) LIKE ?");
      params.push(`%${search.toLowerCase()}%`);
    }
    if (company) { conditions.push("LOWER(ir.company_name) LIKE ?"); params.push(`%${company.toLowerCase()}%`); }
    if (courseId) { conditions.push("sai.course_id = ?"); params.push(Number(courseId)); }
    if (internshipId) { conditions.push("ir.id = ?"); params.push(internshipId); }
    if (from) { conditions.push("DATE(dtr.clock_in) >= ?"); params.push(from); }
    if (through) { conditions.push("DATE(dtr.clock_in) <= ?"); params.push(through); }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const [[count]] = await connection.execute(
      `SELECT COUNT(*) AS total ${fromSql} ${where}`, params,
    );
    const pageSize = 10;
    const [rows] = await connection.execute(
      `SELECT dtr.id, dtr.internship_id, ir.user_id AS student_id,
         CONCAT_WS(' ', p.first_name, p.last_name) AS student_name,
         ir.company_name, ir.internship_position,
         dtr.clock_in, dtr.clock_out, dtr.created_at, dtr.total_hours,
         dtr.clock_in_photo_path, dtr.clock_out_photo_path,
         dtr.is_late, dtr.is_undertime, dtr.is_overtime,
         dtr.status, dtr.flagged, dtr.flag_reason, dtr.auto_closed,
         dtr.auto_closed_at, dtr.proposed_hours, dtr.student_explanation,
         dtr.explanation_submitted_at, dtr.auto_close_review_status,
         dtr.overtime_reason, dtr.overtime_intended_end, dtr.overtime_status
       ${fromSql} ${where}
       ORDER BY dtr.clock_in DESC, dtr.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    const total = Number(count.total) || 0;
    return res.json({ rows, courses, page, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) {
    reportError("Department attendance read failed:", error);
    return res.status(500).json({ error: "Could not load department attendance." });
  } finally {
    connection?.release();
  }
}
