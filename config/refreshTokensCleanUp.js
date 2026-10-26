import { db } from "./db.js";
import { reportBackgroundError } from "./errorTracking.js";

const REVOKED_RETENTION_DAYS =
  process.env.REFRESH_TOKEN_REVOKED_RETENTION_DAYS || 1;
const configuredBatchSize = Number.parseInt(
  process.env.REFRESH_TOKEN_CLEANUP_BATCH_SIZE || "1000",
  10,
);
const BATCH_SIZE = configuredBatchSize > 0 ? configuredBatchSize : 1000;

export const refreshTokensCleanUp = async () => {
  let connection;
  try {
    connection = await db.getConnection();

    // Scan at most 5,000 expired or sufficiently old revoked token JTIs per run.
    // Revoked retention uses the configured day interval, not the refresh controller's
    // short replay-grace interval. Release this scan connection before deletion batches.
    const [staleRecords] = await connection.execute(
      `SELECT jti FROM refresh_tokens
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

    let deletedCount = 0;
    // Delete sequential batches using fresh pooled connections. Earlier successful
    // batches remain deleted if a later batch fails; there is no run-wide transaction.
    for (let i = 0; i < staleRecords.length; i += BATCH_SIZE) {
      const batch = staleRecords.slice(i, i + BATCH_SIZE);
      deletedCount += await deleteBatch(batch);
    }

    console.log(
      `[refreshTokenCleanup] Deleted ${deletedCount} stale token(s).`,
    );
  } catch (error) {
    reportBackgroundError("refreshTokensCleanUp", error);
  } finally {
    if (connection) connection.release();
  }
};

async function deleteBatch(batch) {
  let connection;
  try {
    connection = await db.getConnection();

    const jtis = batch.map((record) => record.jti);

    // Bulk delete in ONE query instead of N queries
    const [result] = await connection.query(
      `DELETE FROM refresh_tokens WHERE jti IN (?)`,
      [jtis],
    );
    return result.affectedRows;
  } finally {
    if (connection) connection.release();
  }
}
