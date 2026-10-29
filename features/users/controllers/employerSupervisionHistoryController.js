import { db } from "../../../config/db.js";
import { reportError } from "../../../config/errorTracking.js";

const PAGE_SIZE = 5;
const completedFrom = `FROM internship_records ir
  INNER JOIN users student ON student.id = ir.user_id AND student.deleted_at IS NULL
  WHERE ir.employer_id = ? AND ir.status IN ('ongoing', 'finished') AND ir.deleted_at IS NULL`;

// Public-to-signed-in profile history, separate from the employer-only dashboard
// and private student work tabs. Return only basic assigned-placement details.
export async function getEmployerSupervisionHistory(req, res) {
  res.set("Cache-Control", "private, no-store");
  const { searchedUserId } = req.params;
  const rawPage = req.query.page ?? "1";
  if (typeof searchedUserId !== "string" || !searchedUserId || searchedUserId.length > 36) {
    return res.status(400).json({ error: "Choose a valid employer profile." });
  }
  if (typeof rawPage !== "string" || !/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(Number(rawPage)) || Number(rawPage) > 1000000) {
    return res.status(400).json({ error: "Choose a valid history page." });
  }
  let connection;
  try {
    connection = await db.getConnection();
    const [[employer]] = await connection.execute(
      `SELECT u.id FROM users u INNER JOIN roles r ON r.id = u.role_id
       WHERE u.id = ? AND r.role = 'employer' AND u.deleted_at IS NULL LIMIT 1`, [searchedUserId]);
    if (!employer) return res.status(404).json({ error: "Employer profile not found." });
    const [[count]] = await connection.execute(`SELECT COUNT(DISTINCT ir.user_id) AS total ${completedFrom}`, [searchedUserId]);
    const total = Number(count.total) || 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Number(rawPage), totalPages);
    let interns = [];
    if (total) {
      // Page student groups first, then load every ongoing/finished placement for those
      // students. Paging raw placements can split one student across two pages.
      const [students] = await connection.execute(
        `SELECT ir.user_id AS student_id ${completedFrom}
         GROUP BY ir.user_id
         ORDER BY MAX(COALESCE(ir.date_ended, ir.date_started)) DESC, ir.user_id DESC
         LIMIT ? OFFSET ?`, [searchedUserId, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
      if (!students.length) return res.json({ success: true, interns: [], pagination: { page, pageSize: PAGE_SIZE, total, totalPages } });
      const [rows] = await connection.execute(
        `SELECT ir.id AS internship_id, ir.user_id AS student_id,
                up.first_name, up.last_name, c.course_name, c.short_name,
                ir.company_name, ir.internship_position, ir.status,
                DATE_FORMAT(ir.date_started, '%Y-%m-%d') AS date_started,
                DATE_FORMAT(ir.date_ended, '%Y-%m-%d') AS date_ended
         FROM internship_records ir
         INNER JOIN users student ON student.id = ir.user_id AND student.deleted_at IS NULL
         LEFT JOIN user_profiles up ON up.user_id = ir.user_id
         LEFT JOIN student_academic_info sai ON sai.id = (
           SELECT MAX(latest.id) FROM student_academic_info latest WHERE latest.user_id = ir.user_id
         )
         LEFT JOIN courses c ON c.id = sai.course_id
         WHERE ir.employer_id = ? AND ir.status IN ('ongoing', 'finished') AND ir.deleted_at IS NULL
           AND ir.user_id IN (${students.map(() => "?").join(",")})
         ORDER BY COALESCE(ir.date_ended, ir.date_started) DESC, ir.id DESC`, [searchedUserId, ...students.map(student => student.student_id)]);
      const grouped = new Map();
      for (const row of rows) {
        if (!grouped.has(row.student_id)) grouped.set(row.student_id, {
          student_id: row.student_id, first_name: row.first_name, last_name: row.last_name,
          course_name: row.course_name, short_name: row.short_name, placements: [],
        });
        grouped.get(row.student_id).placements.push({
          internship_id: row.internship_id, status: row.status, company_name: row.company_name,
          internship_position: row.internship_position, date_started: row.date_started, date_ended: row.date_ended,
        });
      }
      interns = students.map(student => grouped.get(student.student_id)).filter(Boolean);
    }
    return res.json({ success: true, interns, pagination: { page, pageSize: PAGE_SIZE, total, totalPages } });
  } catch (error) {
    reportError("Employer supervision history read failed:", error);
    return res.status(500).json({ error: "Could not load supervised interns. Please try again." });
  } finally { connection?.release(); }
}
