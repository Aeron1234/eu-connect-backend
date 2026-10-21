// Apply this scope in the query that reads confidential employer scores.
// Department membership comes from current database rows, not token claims.
export function evaluationReadScope(viewer, alias = "m") {
  if (viewer?.role === "admin") return { sql: "", params: [] };
  if (viewer?.role === "employer") return { sql: `AND ${alias}.evaluated_by = ?`, params: [viewer.id] };
  if (viewer?.role === "department_head") return {
    sql: `AND EXISTS (
      SELECT 1 FROM dept_heads_background_info evaluation_head
      JOIN student_academic_info evaluation_student
        ON evaluation_student.department_id = evaluation_head.department_id
      WHERE evaluation_head.user_id = ? AND evaluation_student.user_id = ir.user_id
        AND evaluation_student.id = (SELECT MAX(latest_student.id) FROM student_academic_info latest_student WHERE latest_student.user_id = ir.user_id)
    )`,
    params: [viewer.id],
  };
  throw Object.assign(new Error("Employer evaluations are confidential."), { status: 403 });
}

export async function departmentEvaluationRecipients(connection, studentId) {
  const [rows] = await connection.execute(
    `SELECT DISTINCT u.id FROM users u
     JOIN roles r ON r.id = u.role_id
     JOIN dept_heads_background_info dhbi ON dhbi.user_id = u.id
     WHERE r.role = 'department_head' AND u.deleted_at IS NULL
       AND dhbi.department_id = (SELECT department_id FROM student_academic_info WHERE user_id = ? ORDER BY id DESC LIMIT 1)`,
    [studentId],
  );
  return rows;
}
