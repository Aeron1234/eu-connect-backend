import { randomUUID } from "node:crypto";

// Store paths in the deleting transaction; perform storage I/O only after commit.
export async function queueFeedbackFiles(connection, paths) {
  const ids = [];
  for (const path of [...new Set(paths)]) {
    const id = randomUUID();
    await connection.execute("INSERT INTO feedback_file_cleanup (id, storage_path) VALUES (?, ?)", [id, path]);
    ids.push(id);
  }
  return ids;
}
export function createFeedbackFileCleanup({ db, storage, bucket, report = () => {} }) {
  let scheduled = null;
  async function execute(sql, values = []) {
    const c = await db.getConnection();
    try { return await c.execute(sql, values); } finally { c.release(); }
  }
  // Read at most 25 queued objects and release the database connection before
  // calling storage. Specific new deletions bypass the retry-time filter.
  async function drain(ids) {
    const specific = Array.isArray(ids) && ids.length > 0;
    const [rows] = await execute("SELECT id, storage_path FROM feedback_file_cleanup WHERE " +
      (specific ? "id IN (" + ids.map(() => "?").join(",") + ")" : "next_attempt_at <= CURRENT_TIMESTAMP") +
      " ORDER BY next_attempt_at, id LIMIT 25", specific ? ids : []);
    if (!rows.length) return { processed: 0, pending: 0 };
    const keys = rows.map(row => row.id);
    const placeholders = keys.map(() => "?").join(",");
    try {
      const { error } = await storage.from(bucket).remove(rows.map(row => row.storage_path));
      if (error) throw error;
      // Remove queue entries only after storage confirms removal. If that DB step
      // fails, the catch path retains/reschedules work rather than losing the paths.
      await execute("DELETE FROM feedback_file_cleanup WHERE id IN (" + placeholders + ")", keys);
      return { processed: rows.length, pending: 0 };
    } catch (error) {
      report(error);
      // Keep failed jobs durable and retry-eligible in five minutes; the server's
      // periodic cleanup job drains them even after the original request finishes.
      await execute("UPDATE feedback_file_cleanup SET attempts = attempts + 1, next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE) WHERE id IN (" + placeholders + ")", keys);
      return { processed: rows.length, pending: rows.length };
    }
  }
  return ids => {
    // Specific new deletions need not wait behind unrelated retry batches.
    if (ids?.length) return drain(ids);
    // Coalesce generic drains within this process; this is not a distributed worker lock.
    if (!scheduled) scheduled = drain().finally(() => { scheduled = null; });
    return scheduled;
  };
}
