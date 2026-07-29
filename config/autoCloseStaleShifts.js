// jobs/autoCloseStaleShifts.js
import { db } from "../config/db.js"; // adjust path to your actual db module

const MAX_SHIFT_HOURS = process.env.MAX_SHIFT_HOURS; // keep in sync with clockOut, or move to a shared config
const BATCH_SIZE = process.env.BATCH_SIZE;

export const autoCloseStaleShifts = async () => {
  let connection;
  try {
    connection = await db.getConnection();

    // Cap how many we look at per run as a safety net against runaway backlogs
    const [staleRecords] = await connection.execute(
      `SELECT id, internship_id FROM daily_time_records
       WHERE clock_out IS NULL 
         AND TIMESTAMPDIFF(HOUR, clock_in, NOW()) > ?
       LIMIT 5000`,
      [MAX_SHIFT_HOURS],
    );

    connection.release();
    connection = null;

    if (staleRecords.length === 0) {
      console.log("[autoCloseStaleShifts] No stale shifts found.");
      return;
    }

    for (let i = 0; i < staleRecords.length; i += BATCH_SIZE) {
      const batch = staleRecords.slice(i, i + BATCH_SIZE);
      await closeBatch(batch);
    }

    console.log(
      `[autoCloseStaleShifts] Processed ${staleRecords.length} stale shift(s).`,
    );
  } catch (error) {
    console.error("[autoCloseStaleShifts] Error:", error);
  } finally {
    if (connection) connection.release();
  }
};

async function closeBatch(batch) {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const ids = batch.map((r) => r.id);

    // Bulk update daily_time_records in ONE query instead of N queries
    await connection.query(
      `UPDATE daily_time_records
       SET clock_out = DATE_ADD(clock_in, INTERVAL ? HOUR),
           total_hours = ?,
           flagged = 1,
           auto_closed = 1,
           flag_reason = 'Auto-closed: exceeded max shift duration without clock-out',
           status = 'invalid'
       WHERE id IN (?)`,
      [MAX_SHIFT_HOURS, MAX_SHIFT_HOURS, ids],
    );

    // Group by internship_id in case an internship somehow has more than one
    // stale record (rare, but safe to handle)
    const hoursByInternship = {};
    for (const r of batch) {
      hoursByInternship[r.internship_id] =
        (hoursByInternship[r.internship_id] || 0) + MAX_SHIFT_HOURS;
    }

    for (const [internshipId, hoursToAdd] of Object.entries(
      hoursByInternship,
    )) {
      await connection.query(
        `UPDATE internship_records 
         SET accumulated_hours = accumulated_hours + ? 
         WHERE id = ?`,
        [hoursToAdd, internshipId],
      );
    }

    await connection.commit();
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("[autoCloseStaleShifts] Batch error:", error);
  } finally {
    if (connection) connection.release();
  }
}
