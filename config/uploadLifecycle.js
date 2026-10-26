import { db } from "./db.js";
import { supabase } from "./supabase.js";
import { reportError } from "./errorTracking.js";

const BUCKET = process.env.SUPABASE_BUCKET;

export function uploadValidationError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Keep callbacks limited to database work; perform storage I/O outside this scope.
// Preflight reads release their connection before upload, and final saves acquire
// a fresh connection/transaction to recheck eligibility.
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

// Best-effort cleanup bounds the wait per path and logs failures without replacing
// the original upload error. This wait alone does not cancel a removal still in flight.
export async function cleanupUploadPaths(paths, timeoutMs = 10000) {
  await Promise.all(paths.map(async (path) => {
    let timer;
    try {
      const { error } = await Promise.race([
        supabase.storage.from(BUCKET).remove([path]),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Upload storage cleanup timed out.")), timeoutMs); }),
      ]);
      if (error) reportError("Upload storage cleanup failed:", error);
    } catch (error) {
      reportError("Upload storage cleanup failed:", error);
    } finally {
      clearTimeout(timer);
    }
  }));
}

// Run synchronous post-commit cache/socket work without turning a committed
// upload into a reported failure. This wrapper does not await asynchronous work.
export function afterUploadCommit(work) {
  try { work(); }
  catch (error) { reportError("Upload post-commit update failed:", error); }
}
