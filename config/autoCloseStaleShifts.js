import { invalidateAttendanceHistoryCache } from "./cache/attendanceHistoryCache.js";
import { invalidateProfileOverviewCache } from "./cache/profileOverviewCache.js";
import { invalidateDepartmentInternshipsCache } from "./cache/staffInternshipsCache.js";
import { invalidateDashboardCache } from "./cache/dashboardCache.js";
import { db } from "./db.js";
import { reportBackgroundError } from "./errorTracking.js";
import { getMaxShiftHours } from "./shiftLimits.js";
import { invalidateNotificationsCache } from "./cache/notificationsCache.js";

// Break-adjusted duty is only a proposed amount for staff review. It never
// triggers closure or credits an unverified shift.
const workedSecondsSql = `GREATEST(0, TIMESTAMPDIFF(SECOND, clock_in,
  CASE WHEN status = 'on-break' AND break_started_at IS NOT NULL
    THEN break_started_at ELSE NOW() END) - break_total_seconds)`;

// One persisted flag makes the 12-hour alert idempotent across hourly cron runs
// and multiple API processes. The row lock prevents a concurrent manual close.
export const warnLongShifts = async (io) => {
  for (let batch = 0; batch < 50; batch++) {
    let connection;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT id, user_id, internship_id FROM daily_time_records
         WHERE clock_out IS NULL AND wall_warning_sent_at IS NULL
           AND clock_in <= DATE_SUB(NOW(), INTERVAL 12 HOUR)
           AND clock_in > DATE_SUB(NOW(), INTERVAL 16 HOUR)
         ORDER BY clock_in ASC LIMIT 100 FOR UPDATE`,
      );
      if (!rows.length) { await connection.rollback(); return; }
      for (const row of rows) {
        await connection.execute(
          "UPDATE daily_time_records SET wall_warning_sent_at = NOW() WHERE id = ? AND clock_out IS NULL",
          [row.id],
        );
        await connection.execute(
          `INSERT INTO notifications (user_id, type, title, message, link, link_uuid)
           VALUES (?, 'dtr_wall_warning', 'Clock-out reminder',
             'Your shift has been open for at least 12 hours. Please clock out with your location and photo before the 16-hour safety close.',
             '/student', ?)`,
          [row.user_id, row.internship_id],
        );
      }
      await connection.commit();
      for (const row of rows) {
        try { invalidateNotificationsCache(row.user_id); }
        catch (error) { reportBackgroundError("dtrWallWarningCache", error); }
        try {
          io?.to(`user-${row.user_id}`).emit("new_notification", {
            user_id: row.user_id, type: "dtr_wall_warning", title: "Clock-out reminder",
            message: "Your shift has been open for at least 12 hours. Please clock out with your location and photo before the 16-hour safety close.",
            link: "/student", link_uuid: row.internship_id,
          });
        } catch (error) { reportBackgroundError("dtrWallWarningNotification", error); }
      }
      if (rows.length < 100) return;
    } catch (error) {
      if (connection) await connection.rollback();
      reportBackgroundError("warnLongShifts", error);
      return;
    } finally { connection?.release(); }
  }
};

// The scheduler invokes this periodically, so closure may occur after the threshold.
// Bounded scanning and locked rechecks belong to this worker, not to cron itself.
export const autoCloseStaleShifts = async (io) => {
  let connection;
  try {
    const maxCreditHours = getMaxShiftHours();
    const maxWallHours = 16;
    if (maxCreditHours >= maxWallHours) {
      throw new Error("MAX_SHIFT_HOURS must remain below the 16-hour auto-close safety limit.");
    }
    const batchSize = Number(process.env.BATCH_SIZE || 100);
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
      throw new Error("BATCH_SIZE must be a positive whole number.");
    }
    connection = await db.getConnection();

    // Scan at most 5,000 candidates, then process configured-size transaction batches.
    // Release the scan connection before acquiring each batch's connection.
    const [staleRecords] = await connection.execute(
      `SELECT id FROM daily_time_records
       WHERE clock_out IS NULL
         AND clock_in <= DATE_SUB(NOW(), INTERVAL ? HOUR)
       LIMIT 5000`,
      [maxWallHours],
    );

    connection.release();
    connection = null;

    if (staleRecords.length === 0) {
      console.log("[autoCloseStaleShifts] No stale shifts found.");
      return;
    }

    for (let i = 0; i < staleRecords.length; i += batchSize) {
      const batch = staleRecords.slice(i, i + batchSize);
      await closeBatch(batch, maxCreditHours, maxWallHours, io);
    }

    console.log(
      `[autoCloseStaleShifts] Processed ${staleRecords.length} stale shift(s).`,
    );
  } catch (error) {
    reportBackgroundError("autoCloseStaleShifts", error);
  } finally {
    if (connection) connection.release();
  }
};

async function closeBatch(batch, maxCreditHours, maxWallHours, io) {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const ids = batch.map((r) => r.id);
    // A student may have clocked out after the initial scan. Lock and recheck
    // before crediting hours so the job never overwrites a manual clock-out.
    const [openRecords] = await connection.query(
      `SELECT id, user_id, internship_id, break_total_seconds, break_started_at,
              ${workedSecondsSql} AS worked_seconds
       FROM daily_time_records
       WHERE id IN (?) AND clock_out IS NULL
         AND clock_in <= DATE_SUB(NOW(), INTERVAL ? HOUR)
       FOR UPDATE`,
      [ids, maxWallHours],
    );
    if (openRecords.length === 0) {
      await connection.rollback();
      return;
    }
    for (const record of openRecords) {
      const workedSeconds = Math.max(0, Number(record.worked_seconds) || 0);
      const proposedHours = Math.round(Math.min(workedSeconds / 3600, maxCreditHours) * 100) / 100;
      const [updated] = await connection.execute(
        `UPDATE daily_time_records
         SET clock_out = NOW(), auto_closed_at = NOW(),
             total_hours = 0, proposed_hours = ?,
             break_total_seconds = break_total_seconds +
               CASE WHEN break_started_at IS NULL THEN 0 ELSE
                 GREATEST(0, TIMESTAMPDIFF(SECOND, break_started_at, NOW())) END,
             break_started_at = NULL,
             flagged = 1, auto_closed = 1,
             flag_reason = 'Auto-closed without manual clock-out',
             auto_close_review_status = 'pending_explanation',
             status = 'present'
         WHERE id = ? AND clock_out IS NULL`,
        [proposedHours, record.id],
      );
      if (updated.affectedRows !== 1) {
        throw new Error("Auto-close update did not affect the locked shift.");
      }
      await connection.execute(
        `INSERT INTO notifications (user_id, type, title, message, link, link_uuid)
         VALUES (?, 'dtr_auto_close', 'DTR shift auto-closed',
                 'Your shift was closed automatically without a clock-out photo. Add an explanation so your supervisor or department head can review the hours.',
                 '/student', ?)`,
        [record.user_id, record.internship_id],
      );
    }

    // No internship hours are credited until a scoped reviewer confirms them.
    await connection.commit();
    for (const record of openRecords) {
      try { invalidateNotificationsCache(record.user_id); }
      catch (error) { reportBackgroundError("autoCloseStaleShiftsCache", error); }
      try {
        io?.to(`user-${record.user_id}`).emit("new_notification", {
          user_id: record.user_id, type: "dtr_auto_close", title: "DTR shift auto-closed",
          message: "Your shift was closed automatically without a clock-out photo. Add an explanation so your supervisor or department head can review the hours.",
          link: "/student", link_uuid: record.internship_id,
        });
      } catch (error) { reportBackgroundError("autoCloseStaleShiftsNotification", error); }
    }
    try {
      invalidateAttendanceHistoryCache();
      invalidateProfileOverviewCache();
      invalidateDashboardCache();
      invalidateDepartmentInternshipsCache();
    } catch (error) { reportBackgroundError("autoCloseStaleShiftsCache", error); }
  } catch (error) {
    if (connection) await connection.rollback();
    reportBackgroundError("autoCloseStaleShiftsBatch", error);
  } finally {
    if (connection) connection.release();
  }
}
