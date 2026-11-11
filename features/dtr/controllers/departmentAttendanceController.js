import { db } from "../../../config/db.js";
import { reportError } from "../../../config/errorTracking.js";
import { readAttendanceTimeline } from "../attendanceTimeline.js";

// Every query derives the head's current department from the database. The
// latest academic row determines student membership, as on Records and photos.
export async function getDepartmentAttendance(req, res) {
  res.set("Cache-Control", "private, no-store");
  if (req.verifiedUser.role !== 'department_head')
    return res.status(403).json({ error: 'Department-head access required.' });
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
    if (from) { conditions.push("DATE(COALESCE(dtr.expected_clock_in, dtr.clock_in, dtr.created_at)) >= ?"); params.push(from); }
    if (through) { conditions.push("DATE(COALESCE(dtr.expected_clock_in, dtr.clock_in, dtr.created_at)) <= ?"); params.push(through); }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const pageSize = 10;
    // Reuse every current department/search/course/date predicate for both sources.
    const reportFrom = fromSql.replace('daily_time_records dtr', 'dtr_absence_reports r').replace('ir.id = dtr.internship_id', 'ir.id = r.internship_id');
    const reportWhere = where.replaceAll('DATE(COALESCE(dtr.expected_clock_in, dtr.clock_in, dtr.created_at))', 'r.shift_date');
    const { rows: timeline, total } = await readAttendanceTimeline(connection, {
      attendance: { fields: "dtr.*, ir.user_id AS student_id, CONCAT_WS(' ', p.first_name, p.last_name) AS student_name, ir.company_name, ir.internship_position", from: fromSql, where, params },
      absences: { fields: "r.*, CONCAT_WS(' ', p.first_name, p.last_name) AS student_name, ir.company_name", from: reportFrom, where: reportWhere, params },
      limit: pageSize, offset: (page - 1) * pageSize,
    });
    const rows = timeline.map(row => row.absence_report ? { ...row, absence_staff: true } : row);
    return res.json({ rows, courses, page, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) {
    reportError("Department attendance read failed:", error);
    return res.status(500).json({ error: "Could not load department attendance." });
  } finally {
    connection?.release();
  }
}
