// Fixed table names only: this worker never accepts identifiers from requests.
export const RETENTION_TABLES = [
  "company_evaluation_masters", "student_evaluation_masters",
  "internship_rotations", "internship_postings", "internship_records",
];

async function deleteEvaluation(connection, table, id) {
  const scores = table === "company_evaluation_masters" ? "company_evaluation_scores" : "student_evaluation_scores";
  await connection.execute(`DELETE FROM ${scores} WHERE evaluation_master_id = ?`, [id]);
  await connection.execute("DELETE FROM notifications WHERE link_uuid = ? AND type IN ('evaluation_submitted', 'evaluation_deleted')", [id]);
  await connection.execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
}

async function deleteInternship(connection, id, queueFiles) {
  // Collect private objects before cascades remove their metadata. Queue writes
  // share the deletion transaction, so a rollback never schedules live files.
  const [photos] = await connection.execute("SELECT clock_in_photo_path, clock_out_photo_path FROM daily_time_records WHERE internship_id = ?", [id]);
  const [documents] = await connection.execute("SELECT path FROM internship_documents WHERE internship_id = ?", [id]);
  const [reports] = await connection.execute("SELECT attachment_path FROM summary_reports WHERE internship_id = ?", [id]);
  const [images] = await connection.execute("SELECT i.storage_path FROM summary_report_images i JOIN summary_reports r ON r.id = i.report_id WHERE r.internship_id = ?", [id]);
  await queueFiles(connection, [...photos.flatMap(row => [row.clock_in_photo_path, row.clock_out_photo_path]), ...documents.map(row => row.path), ...reports.map(row => row.attachment_path), ...images.map(row => row.storage_path)]);
  for (const table of RETENTION_TABLES.slice(0, 2)) {
    const [evaluations] = await connection.execute(`SELECT id FROM ${table} WHERE internship_record_id = ? FOR UPDATE`, [id]);
    for (const row of evaluations) await deleteEvaluation(connection, table, row.id);
  }
  // These references do not all cascade in the deployed MariaDB schema.
  await connection.execute("DELETE i FROM summary_report_images i JOIN summary_reports r ON r.id = i.report_id WHERE r.internship_id = ?", [id]);
  for (const table of ["summary_reports", "weekly_narratives", "daily_narratives", "daily_time_records", "internship_documents", "dtr_locations", "dtr_shift_restrictions", "internship_rotations", "supervisor_requests"]) {
    await connection.execute(`DELETE FROM ${table} WHERE internship_id = ?`, [id]);
  }
  await connection.execute("DELETE FROM alumni_internship_records WHERE internship_record_id = ?", [id]);
  await connection.execute("DELETE FROM notifications WHERE link_uuid = ?", [id]);
  await connection.execute("DELETE FROM internship_records WHERE id = ?", [id]);
}

// Dependency injection keeps retention tests independent of live DB/storage.
// Each run processes at most 100 rows per family; later daily runs drain backlog.
export async function purgeExpiredSoftDeletes({ pool, queueFiles, invalidate, onError }) {
  const connection = await pool.getConnection();
  const counts = {};
  let locked = false;
  try {
    const [[lock]] = await connection.execute("SELECT GET_LOCK('eu_connect_soft_delete_retention', 0) AS acquired");
    locked = Number(lock.acquired) === 1;
    if (!locked) return { skipped: true, counts };
    for (const table of RETENTION_TABLES) {
      const [rows] = await connection.execute(`SELECT id FROM ${table} WHERE deleted_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY) ORDER BY deleted_at, id LIMIT 100`);
      counts[table] = 0;
      for (const { id } of rows) {
        try {
          await connection.beginTransaction();
          // Recheck under lock: a restored or concurrently removed row is skipped.
          const [eligible] = await connection.execute(`SELECT id FROM ${table} WHERE id = ? AND deleted_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY) FOR UPDATE`, [id]);
          if (!eligible.length) { await connection.rollback(); continue; }
          if (table === "internship_records") await deleteInternship(connection, id, queueFiles);
          else if (table.endsWith("evaluation_masters")) await deleteEvaluation(connection, table, id);
          else {
            if (table === "internship_postings") {
              await connection.execute("DELETE FROM internship_favorites WHERE posting_id = ?", [id]);
              await connection.execute("DELETE FROM internship_posting_courses WHERE posting_id = ?", [id]);
            }
            // Rotation assignments in narratives are JSON snapshots, retained as history.
            await connection.execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
          }
          await connection.commit();
          counts[table]++;
          invalidate();
        } catch (error) {
          await connection.rollback().catch(() => {});
          onError(error, { table, id });
        }
      }
    }
    return { skipped: false, counts };
  } finally {
    try { if (locked) await connection.execute("SELECT RELEASE_LOCK('eu_connect_soft_delete_retention')"); }
    finally { connection.release(); }
  }
}
