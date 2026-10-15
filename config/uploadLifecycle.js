import { db } from "./db.js";
import { supabase } from "./supabase.js";
import { reportError } from "./errorTracking.js";

const BUCKET = process.env.SUPABASE_BUCKET;

export function uploadValidationError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Callbacks do database work only. Storage uploads and cleanup run after this
// scope returns, so they never reserve a pooled connection or hold row locks.
export async function withUploadConnection(work, transaction = false) {
  const connection = await db.getConnection();
  let started = false;
  let commitAttempted = false;
  try {
    if (transaction) {
      await connection.beginTransaction();
      started = true;
    }
    const result = await work(connection);
    if (transaction) {
      commitAttempted = true;
      await connection.commit();
    }
    return result;
  } catch (error) {
    if (started) {
      try { await connection.rollback(); }
      catch (rollbackError) { reportError("Upload transaction rollback failed:", rollbackError); }
    }
    if (commitAttempted) {
      // A lost COMMIT acknowledgement can mean the write actually succeeded.
      // Preserve storage objects rather than delete a potentially saved file.
      const failure = error instanceof Error ? error : new Error("Upload commit failed.", { cause: error });
      failure.uploadCommitUncertain = true;
      throw failure;
    }
    throw error;
  } finally {
    try { connection.release(); }
    catch (error) { reportError("Upload connection release failed:", error); }
  }
}

export async function cleanupUploadPaths(paths) {
  await Promise.all(paths.map(async (path) => {
    try {
      const { error } = await supabase.storage.from(BUCKET).remove([path]);
      if (error) reportError("Upload storage cleanup failed:", error);
    } catch (error) {
      reportError("Upload storage cleanup failed:", error);
    }
  }));
}

export function afterUploadCommit(work) {
  try { work(); }
  catch (error) { reportError("Upload post-commit update failed:", error); }
}
