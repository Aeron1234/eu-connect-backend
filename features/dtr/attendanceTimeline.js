// Page the combined timeline in SQL before loading details. Each source carries
// its own authorization and filters; private reports never enter employer reads.
export async function readAttendanceTimeline(connection, { attendance, absences, limit, offset }) {
  const reportWhere = `${absences.where} AND NOT EXISTS (
    SELECT 1 FROM daily_time_records corrected WHERE corrected.id = r.correction_dtr_id
  )`;
  const union = `SELECT 'dtr' AS kind, dtr.id AS row_id,
      COALESCE(dtr.expected_clock_in, dtr.clock_in, dtr.created_at) AS sort_date
    ${attendance.from} ${attendance.where}
    UNION ALL
    SELECT 'absence' AS kind, r.id AS row_id, r.shift_date AS sort_date
    ${absences.from} ${reportWhere}`;
  const params = [...attendance.params, ...absences.params];
  const [[count]] = await connection.execute(`SELECT COUNT(*) AS total FROM (${union}) timeline`, params);
  const [keys] = await connection.execute(`SELECT * FROM (${union}) timeline
    ORDER BY sort_date DESC, kind ASC, row_id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const dtrIds = keys.filter(row => row.kind === 'dtr').map(row => row.row_id);
  const reportIds = keys.filter(row => row.kind === 'absence').map(row => row.row_id);
  const placeholders = ids => ids.map(() => '?').join(',');
  const [dtrs] = dtrIds.length ? await connection.execute(
    `SELECT ${attendance.fields} ${attendance.from} ${attendance.where}
     AND dtr.id IN (${placeholders(dtrIds)})`, [...attendance.params, ...dtrIds]) : [[]];
  const reportConditions = [];
  if (reportIds.length) reportConditions.push(`r.id IN (${placeholders(reportIds)})`);
  if (dtrIds.length) reportConditions.push(`r.correction_dtr_id IN (${placeholders(dtrIds)})`);
  const [reports] = reportConditions.length ? await connection.execute(
    `SELECT ${absences.fields}, DATE_FORMAT(r.shift_date, '%Y-%m-%d') AS shift_date
     ${absences.from} ${absences.where} AND (${reportConditions.join(' OR ')})`,
    [...absences.params, ...reportIds, ...dtrIds]) : [[]];
  const corrections = new Map(reports.filter(r => r.correction_dtr_id != null).map(r => [String(r.correction_dtr_id), r]));
  const attendanceRows = new Map(dtrs.map(row => [String(row.id), {
    ...row, ...(corrections.has(String(row.id)) ? { absence_report: corrections.get(String(row.id)) } : {}),
  }]));
  const absenceRows = new Map(reports.map(report => [String(report.id), {
    id: `absence-${report.id}`, internship_id: report.internship_id,
    student_id: report.student_id, student_name: report.student_name, company_name: report.company_name,
    created_at: report.shift_date, total_hours: 0,
    status: ({ no_duty: 'No duty', worked: 'Attendance correction', leave: 'Leave' })[report.category] || 'absent',
    absence_report: report,
  }]));
  return { rows: keys.map(key => (key.kind === 'dtr' ? attendanceRows : absenceRows).get(String(key.row_id))).filter(Boolean),
    total: Number(count.total) || 0 };
}
