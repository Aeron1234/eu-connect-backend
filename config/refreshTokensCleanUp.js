// jobs/refreshTokenCleanup.js
import { db } from "../config/db.js"; // adjust path to your actual db module

const REVOKED_RETENTION_DAYS =
  process.env.REFRESH_TOKEN_REVOKED_RETENTION_DAYS || 1;
const BATCH_SIZE = process.env.REFRESH_TOKEN_CLEANUP_BATCH_SIZE || 1000;

export const refreshTokensCleanUp = async () => {
  let connection;
  try {
    connection = await db.getConnection();

    // Cap how many we look at per run as a safety net against runaway backlogs.
    // Only deletes rows that are no longer useful for reuse-detection:
    // fully expired, or revoked long enough ago that the grace-period
    // check in the refresh controller would never need them.
    const [staleRecords] = await connection.execute(
      `SELECT id FROM refresh_tokens
       WHERE expires_at < NOW()
          OR (revoked_at IS NOT NULL AND revoked_at < DATE_SUB(NOW(), INTERVAL ? DAY))
       LIMIT 5000`,
      [REVOKED_RETENTION_DAYS],
    );

    connection.release();
    connection = null;

    if (staleRecords.length === 0) {
      console.log("[refreshTokenCleanup] No stale tokens found.");
      return;
    }

    for (let i = 0; i < staleRecords.length; i += BATCH_SIZE) {
      const batch = staleRecords.slice(i, i + BATCH_SIZE);
      await deleteBatch(batch);
    }

    console.log(
      `[refreshTokenCleanup] Deleted ${staleRecords.length} stale token(s).`,
    );
  } catch (error) {
    console.error("[refreshTokenCleanup] Error:", error);
  } finally {
    if (connection) connection.release();
  }
};

async function deleteBatch(batch) {
  let connection;
  try {
    connection = await db.getConnection();

    const ids = batch.map((r) => r.id);

    // Bulk delete in ONE query instead of N queries
    await connection.query(`DELETE FROM refresh_tokens WHERE id IN (?)`, [ids]);
  } catch (error) {
    console.error("[refreshTokenCleanup] Batch error:", error);
  } finally {
    if (connection) connection.release();
  }
}
