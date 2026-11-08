import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { supabase } from "./supabase.js";
import { reportError } from "./errorTracking.js";

// Queue in the same transaction that removes the DTR. Storage failures can
// then be retried without retaining a deleted attendance row or losing paths.
export async function queueDtrPhotoCleanup(connection, paths) {
  const ids = [];
  for (const path of [...new Set(paths.filter(Boolean))]) {
    const id = randomUUID();
    await connection.execute("INSERT INTO dtr_photo_cleanup (id, storage_path) VALUES (?, ?)", [id, path]);
    ids.push(id);
  }
  return ids;
}

export async function cleanupDtrPhotos(ids) {
  const specific = Array.isArray(ids) && ids.length > 0;
  let connection = await db.getConnection();
  let rows;
  try {
    [rows] = await connection.execute(
      `SELECT id, storage_path FROM dtr_photo_cleanup WHERE ${specific
        ? `id IN (${ids.map(() => "?").join(",")})` : "next_attempt_at <= CURRENT_TIMESTAMP"}
       ORDER BY next_attempt_at, id LIMIT 25`, specific ? ids : [],
    );
  } finally { connection.release(); }
  if (!rows.length) return { pending: 0 };
  const keys = rows.map(row => row.id);
  const placeholders = keys.map(() => "?").join(",");
  let pending = 0;
  try {
    const { error } = await supabase.storage.from(process.env.SUPABASE_BUCKET).remove(rows.map(row => row.storage_path));
    if (error) throw error;
    connection = await db.getConnection();
    try { await connection.execute(`DELETE FROM dtr_photo_cleanup WHERE id IN (${placeholders})`, keys); }
    finally { connection.release(); }
  } catch (error) {
    reportError("DTR photo cleanup failed; queued for retry:", error);
    pending = rows.length;
    connection = await db.getConnection();
    try {
      await connection.execute(
        `UPDATE dtr_photo_cleanup SET attempts = attempts + 1,
         next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE)
         WHERE id IN (${placeholders})`, keys,
      );
    } finally { connection.release(); }
  }
  return { pending };
}
