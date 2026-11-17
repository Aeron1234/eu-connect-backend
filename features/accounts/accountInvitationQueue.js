import { db } from "../../config/db.js";
import { prepareAccountSetup, deliverAccountSetup } from "../auth/accountSetup.js";
import { invalidateRouteCache } from "../../config/cache/cache.js";

// Durable jobs store only the account ID. Plaintext setup tokens stay in memory.
export async function drainAccountInvitations() {
  const connection = await db.getConnection();
  let locked = false;
  try {
    const [[lock]] = await connection.execute("SELECT GET_LOCK('account_invitation_jobs', 0) AS acquired");
    locked = Number(lock?.acquired) === 1;
    if (!locked) return;
    // A crash can leave delivery uncertain. Let the administrator explicitly resend.
    await connection.execute("UPDATE account_invitation_jobs SET status = 'failed' WHERE status = 'processing'");
    const [jobs] = await connection.execute("SELECT user_id FROM account_invitation_jobs WHERE status = 'pending' ORDER BY created_at, user_id LIMIT 5");
    for (const job of jobs) {
      let invitation;
      try {
        await connection.beginTransaction();
        const [[user]] = await connection.execute(
          "SELECT id, email, username, status, deleted_at, password_setup_required FROM users WHERE id = ? FOR UPDATE", [job.user_id]);
        if (!user || user.deleted_at || user.status !== "active" || !Number(user.password_setup_required)) {
          await connection.execute("UPDATE account_invitation_jobs SET status = 'cancelled' WHERE user_id = ?", [job.user_id]);
        } else {
          invitation = await prepareAccountSetup(connection, user);
          await connection.execute("UPDATE account_invitation_jobs SET status = 'processing' WHERE user_id = ?", [job.user_id]);
        }
        await connection.commit();
      } catch {
        await connection.rollback();
        await connection.execute("UPDATE account_invitation_jobs SET status = 'failed' WHERE user_id = ?", [job.user_id]);
        continue;
      }
      if (invitation) {
        const sent = await deliverAccountSetup(invitation);
        await connection.execute("UPDATE account_invitation_jobs SET status = ? WHERE user_id = ?", [sent ? "sent" : "failed", job.user_id]);
      }
    }
    invalidateRouteCache("/api/v1/accounts");
  } finally {
    try { if (locked) await connection.execute("SELECT RELEASE_LOCK('account_invitation_jobs')"); }
    finally { connection.release(); }
  }
}

