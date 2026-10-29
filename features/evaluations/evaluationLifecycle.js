import { db } from '../../config/db.js';
import { reportError } from '../../config/errorTracking.js';
import { invalidateEvaluationHistoryCache } from '../../config/cache/evaluationHistoryCache.js';
import { invalidateNotificationsCache } from '../../config/cache/notificationsCache.js';
import { invalidateActivityLogsCache } from '../../config/cache/activityLogsCache.js';
import { invalidateRouteCache } from '../../config/cache/cache.js';
import { evaluationReadScope } from './evaluationAccess.js';

// Student-authored supervisor evaluations retain one active entry per internship.
// Call while holding the internship row lock to serialize competing submissions;
// soft-deleted history does not block replacement. Table names are internal constants.
export async function assertNoActiveEvaluation(connection, table, internshipId) {
  const [existing] = await connection.execute(
    `SELECT id FROM ${table} WHERE internship_record_id = ? AND deleted_at IS NULL LIMIT 1`, [internshipId]);
  if (existing.length) throw Object.assign(new Error('An active evaluation already exists for this internship. Delete it before posting a replacement.'), { status: 409, code: 'EVALUATION_ALREADY_EXISTS' });
}

// Share the deletion lifecycle across both directions using controller constants.
// Table/column configuration must never come from request input.
export function evaluationDeleteHandler({ table, scoresTable, ownerColumn, authorRole }) {
  return async (req, res) => {
    const viewer = req.verifiedUser;
    if (![authorRole, 'admin', 'department_head'].includes(viewer?.role)) return res.status(403).json({ error: 'Access denied.' });
    const id = req.params.evaluationId;
    if (!id) return res.status(400).json({ error: 'Evaluation ID is required.' });
    const staff = ['admin', 'department_head'].includes(viewer.role);
    let connection;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      // Authors are restricted to their own rows. Staff reuse current department
      // scope in the locked read; admin has no department restriction.
      const scope = staff ? evaluationReadScope(viewer) : { sql: `AND m.${ownerColumn} = ?`, params: [viewer.id] };
      const [[evaluation]] = await connection.execute(
        `SELECT m.id, m.deleted_at, m.internship_record_id, m.${ownerColumn} AS author_id, ir.company_name
         FROM ${table} m JOIN internship_records ir ON ir.id = m.internship_record_id
         WHERE m.id = ? ${scope.sql} FOR UPDATE`, [id, ...scope.params]);
      if (!evaluation) {
        await connection.rollback();
        return res.status(404).json({ error: 'Evaluation not found or access denied.' });
      }
      // Staff may purge only after author deletion. Authors cannot delete a row twice.
      if (staff && !evaluation.deleted_at) {
        await connection.rollback();
        return res.status(409).json({ error: 'Only evaluations already deleted by their author can be permanently deleted.' });
      }
      if (!staff && evaluation.deleted_at) {
        await connection.rollback();
        return res.status(404).json({ error: 'Evaluation already deleted.' });
      }
      // Purge removes scores, linked notification rows and the deleted master together.
      // Author deletion only timestamps the master, retaining staff-visible history.
      if (staff) {
        await connection.execute(`DELETE FROM ${scoresTable} WHERE evaluation_master_id = ?`, [id]);
        await connection.execute(`DELETE FROM notifications WHERE link_uuid = ? AND type IN ('evaluation_submitted', 'evaluation_deleted')`, [id]);
        const [deleted] = await connection.execute(`DELETE FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`, [id]);
        if (deleted.affectedRows !== 1) throw new Error('Evaluation purge did not remove exactly one row.');
      } else {
        const [deleted] = await connection.execute(`UPDATE ${table} SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`, [id]);
        if (deleted.affectedRows !== 1) throw new Error('Evaluation soft deletion did not update exactly one row.');
      }
      await connection.execute(
        `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [viewer.id, viewer.role, staff ? 'evaluation_permanently_deleted' : 'evaluation_soft_deleted', table, id,
          `${staff ? 'Permanently deleted' : 'Deleted'} an evaluation for the internship at ${evaluation.company_name}.`,
          JSON.stringify({ internship_record_id: evaluation.internship_record_id })]);
      // Commit the deletion and audit entry before invalidating history, notification
      // and dashboard data. A failed transaction leaves those caches untouched.
      await connection.commit();
      invalidateEvaluationHistoryCache();
      invalidateNotificationsCache();
      invalidateActivityLogsCache();
      invalidateRouteCache('/api/v1/department-head-dashboard-data');
      return res.json({ success: true, permanently_deleted: staff, message: staff ? 'Evaluation permanently deleted.' : authorRole === 'student' ? 'Evaluation deleted. A replacement can now be posted.' : 'Evaluation deleted.' });
    } catch (error) {
      if (connection) await connection.rollback();
      reportError('Delete evaluation failed:', error);
      return res.status(500).json({ error: 'Could not delete the evaluation.' });
    } finally { connection?.release(); }
  };
}

// Check ongoing assignment and, only for student-authored supervisor feedback,
// the active slot. Performance reviews may repeat. Start dates are checked on submit.
// It is no-store UI guidance; submission rechecks the current state under a lock.
export function evaluationEligibilityHandler(direction) {
  const performance = direction === 'performance';
  return async (req, res) => {
    const viewer = req.verifiedUser;
    if (viewer?.role !== (performance ? 'employer' : 'student')) return res.status(403).json({ error: 'Access denied.' });
    const studentId = performance ? req.params.studentId : viewer.id;
    let connection;
    try {
      connection = await db.getConnection();
      const activeCheck = performance ? '' : ', EXISTS(SELECT 1 FROM employer_evaluation_masters m WHERE m.internship_record_id = ir.id AND m.deleted_at IS NULL) AS has_evaluation';
      const params = performance ? [studentId, viewer.id] : [studentId];
      const [[record]] = await connection.execute(
        `SELECT ir.id${activeCheck}
         FROM internship_records ir WHERE ir.user_id = ? AND ir.status = 'ongoing' AND ir.deleted_at IS NULL AND ir.employer_id IS NOT NULL
         ${performance ? 'AND ir.employer_id = ?' : ''} ORDER BY ir.created_at DESC LIMIT 1`, params);
      res.set?.('Cache-Control', 'private, no-store');
      return res.json({ can_post: Boolean(record && (performance || !Number(record.has_evaluation))), internship_record_id: record?.id || null,
        message: !record ? 'An ongoing internship with an accepted supervisor is required.' : !performance && Number(record.has_evaluation) ? 'You already have an active evaluation for this internship. Delete it from your history before posting a replacement.' : '' });
    } catch (error) {
      reportError('Evaluation eligibility failed:', error);
      return res.status(500).json({ error: 'Could not check whether you can post an evaluation.' });
    } finally { connection?.release(); }
  };
}
