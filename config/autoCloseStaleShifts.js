import { invalidateAttendanceHistoryCache } from "./cache/attendanceHistoryCache.js";
import { invalidateProfileOverviewCache } from "./cache/profileOverviewCache.js";
import { invalidateDepartmentInternshipsCache } from "./cache/staffInternshipsCache.js";
import { invalidateDashboardCache } from "./cache/dashboardCache.js";
import { db } from "./db.js";
import { reportBackgroundError } from "./errorTracking.js";
import { getMaxShiftHours } from "./shiftLimits.js";

// Subtract completed breaks and, while on break, freeze elapsed duty at break_started_at.
// Clamp negative totals to zero; wall-clock age is checked separately.
const workedSecondsSql = `GREATEST(0, TIMESTAMPDIFF(SECOND, clock_in,
  CASE WHEN status = 'on-break' AND break_started_at IS NOT NULL
    THEN break_started_at ELSE NOW() END) - break_total_seconds)`;

export const autoCloseStaleShifts = async () => {
  let connection;
  try {
    const maxShiftHours = getMaxShiftHours();
    // The wall limit catches forgotten breaks even when duty time is paused.
    // It defaults to duty cap plus two hours and must exceed the duty cap.
    const maxWallHours = Number(process.env.MAX_SHIFT_WALL_HOURS || maxShiftHours + 2);
    if (!Number.isSafeInteger(maxWallHours) || maxWallHours <= maxShiftHours) {
      throw new Error("MAX_SHIFT_WALL_HOURS must exceed MAX_SHIFT_HOURS.");
    }
    const batchSize = Number(process.env.BATCH_SIZE || 100);
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
      throw new Error("BATCH_SIZE must be a positive whole number.");
    }
    connection = await db.getConnection();

    // Scan at most 5,000 candidates, then process configured-size transaction batches.
    // Release the scan connection before acquiring each batch's connection.
    const [staleRecords] = await connection.execute(
      `SELECT id, internship_id FROM daily_time_records
       WHERE clock_out IS NULL
         AND (${workedSecondsSql} >= ?
              OR clock_in <= DATE_SUB(NOW(), INTERVAL ? HOUR))
       LIMIT 5000`,
      [maxShiftHours * 3600, maxWallHours],
    );

    connection.release();
    connection = null;

    if (staleRecords.length === 0) {
      console.log("[autoCloseStaleShifts] No stale shifts found.");
      return;
    }

    for (let i = 0; i < staleRecords.length; i += batchSize) {
      const batch = staleRecords.slice(i, i + batchSize);
      await closeBatch(batch, maxShiftHours, maxWallHours);
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

async function closeBatch(batch, maxShiftHours, maxWallHours) {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const ids = batch.map((r) => r.id);
    // A student may have clocked out after the initial scan. Lock and recheck
    // before crediting hours so the job never overwrites a manual clock-out.
    const [openRecords] = await connection.query(
      `SELECT id, internship_id, break_total_seconds, break_started_at,
              ${workedSecondsSql} AS worked_seconds
       FROM daily_time_records
       WHERE id IN (?) AND clock_out IS NULL
         AND (${workedSecondsSql} >= ?
              OR clock_in <= DATE_SUB(NOW(), INTERVAL ? HOUR))
       FOR UPDATE`,
      [ids, maxShiftHours * 3600, maxWallHours],
    );
    if (openRecords.length === 0) {
      await connection.rollback();
      return;
    }
    const hoursByInternship = new Map();
    for (const record of openRecords) {
      const workedSeconds = Math.max(0, Number(record.worked_seconds) || 0);
      // Credit at most the duty cap. If reached, place clock-out at clock-in plus
      // completed breaks plus capped duty; wall-only closures use the current DB time.
      const reachedDutyCap = workedSeconds >= maxShiftHours * 3600;
      const creditedHours = Math.min(workedSeconds, maxShiftHours * 3600) / 3600;
      const closeOffsetSeconds = (Number(record.break_total_seconds) || 0) + maxShiftHours * 3600;
      const [updated] = await connection.execute(
        `UPDATE daily_time_records
         SET clock_out = CASE WHEN ? THEN DATE_ADD(clock_in, INTERVAL ? SECOND)
                              ELSE NOW() END,
             total_hours = ?,
             break_total_seconds = break_total_seconds +
               CASE WHEN break_started_at IS NULL THEN 0 ELSE
                 GREATEST(0, TIMESTAMPDIFF(SECOND, break_started_at,
                   CASE WHEN ? THEN DATE_ADD(clock_in, INTERVAL ? SECOND)
                                ELSE NOW() END)) END,
             break_started_at = NULL,
             flagged = 1, auto_closed = 1,
             flag_reason = 'Auto-closed without manual clock-out',
             status = 'present'
         WHERE id = ? AND clock_out IS NULL`,
        [reachedDutyCap, closeOffsetSeconds, creditedHours,
         reachedDutyCap, closeOffsetSeconds, record.id],
      );
      if (updated.affectedRows !== 1) {
        throw new Error("Auto-close update did not affect the locked shift.");
      }
      // Aggregate only successfully closed rows for the internship credit updates
      // in this transaction; a later failure rolls back the whole batch.
      hoursByInternship.set(
        record.internship_id,
        (hoursByInternship.get(record.internship_id) || 0) + creditedHours,
      );
    }

    for (const [internshipId, hoursToAdd] of hoursByInternship) {
      const [updatedInternship] = await connection.query(
        `UPDATE internship_records 
         SET accumulated_hours = accumulated_hours + ? 
         WHERE id = ?`,
        [hoursToAdd, internshipId],
      );
      if (updatedInternship.affectedRows === 0) {
        throw new Error(`Unable to credit hours to internship ${internshipId}.`);
      }
    }

    // Publish cache invalidations after both shift closure and accumulated credits commit.
    await connection.commit();
    invalidateAttendanceHistoryCache();
    invalidateProfileOverviewCache();
    invalidateDashboardCache();
    invalidateDepartmentInternshipsCache();
  } catch (error) {
    if (connection) await connection.rollback();
    reportBackgroundError("autoCloseStaleShiftsBatch", error);
  } finally {
    if (connection) connection.release();
  }
}
