// Read current academic assignments from the database rather than JWT claims.
export async function studentCriteriaDepartment(connection, studentId) {
  const [rows] = await connection.execute(
    `SELECT department_id FROM student_academic_info WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    [studentId],
  );
  return rows[0]?.department_id ?? null;
}

export async function headCriteriaDepartment(connection, headId) {
  const [rows] = await connection.execute(
    `SELECT h.department_id, d.code FROM dept_heads_background_info h
     JOIN departments d ON d.id = h.department_id WHERE h.user_id = ? LIMIT 1`,
    [headId],
  );
  return rows[0]?.code === "REG" ? null : rows[0]?.department_id ?? null;
}

// A submitted form must contain each currently active question exactly once.
// IDs remain stable when wording is reused across departments or sections.
export async function validateCriteriaScores(connection, tableName, departmentId, scores) {
  const [rows] = await connection.execute(
    `SELECT id FROM ${tableName} WHERE department_id = ? AND is_active = 1`,
    [departmentId],
  );
  const expected = new Set(rows.map((row) => Number(row.id)));
  if (!expected.size || !Array.isArray(scores) || scores.length !== expected.size) return false;
  const submitted = new Set();
  for (const item of scores) {
    const id = Number(item.criterion_id);
    const score = Number(item.score);
    if (!expected.has(id) || submitted.has(id) || !Number.isInteger(score) || score < 0 || score > 5 || item.score === "" || item.score == null) return false;
    submitted.add(id);
  }
  return true;
}
