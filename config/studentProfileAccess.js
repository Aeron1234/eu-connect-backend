import { db } from "./db.js";
import { reportError } from "./errorTracking.js";

export async function canHeadReadStudentRecords(connection, headId, studentId) {
  const [rows] = await connection.execute(
    `SELECT profile_student.department_id AS student_department_id,
            (SELECT profile_head.department_id FROM dept_heads_background_info profile_head
             WHERE profile_head.user_id = ? LIMIT 1) AS head_department_id
     FROM student_academic_info profile_student
     WHERE profile_student.user_id = ?
     ORDER BY profile_student.id DESC LIMIT 1`,
    [headId, studentId],
  );
  const scope = rows[0];
  return scope?.student_department_id != null && scope?.head_department_id != null &&
    String(scope.student_department_id) === String(scope.head_department_id);
}

// Run before response-cache lookup as well as before reads/mutations.
export async function requireStudentDepartmentAccess(req, res, next) {
  if (req.verifiedUser?.role !== "department_head") return next();
  const studentId = req.params.studentId || req.params.searchedUserId;
  if (!studentId) return res.status(400).json({ error: "A student ID is required." });
  let connection;
  try {
    connection = await db.getConnection();
    const allowed = await canHeadReadStudentRecords(connection, req.verifiedUser.id, studentId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: "You can only view internship records for students in your department.",
      });
    }
  } catch (error) {
    reportError("Student profile department access check failed:", error);
    return res.status(500).json({ success: false, error: "Could not verify student profile access." });
  } finally {
    connection?.release();
  }
  return next();
}
