import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../../config/db.js';
import { looksLikeJwt } from '../../config/jwt.js';
import { AccountSetupMailError, sendAccountSetupEmail } from '../../services/accountSetupMail.js';
import { reportError } from '../../config/errorTracking.js';
import { invalidateUserCache, invalidateRouteCache } from '../../config/cache/cache.js';
import { invalidateActivityLogsCache } from '../../config/cache/activityLogsCache.js';

const digest = token => crypto.createHash('sha256').update(token).digest('hex');
const invalidLink = 'This link is invalid, expired, or already used. Request a new email or ask your administrator to resend the invitation.';

function reportSetupFailure(context, error) {
  const hints = {
    EMAIL_CONFIGURATION_REQUIRED: 'Check the backend EmailJS variables and CLIENT_URL.',
    EMAIL_QUEUE_BUSY: 'The email queue is full; wait before retrying.',
    EMAIL_DELIVERY_TIMEOUT: 'Email delivery timed out; check provider history before retrying.',
    EMAIL_NETWORK_ERROR: 'Could not reach EmailJS; check backend network access.',
    EMAIL_PROVIDER_REJECTED: 'EmailJS rejected the request. Check Account > Security non-browser API/private-key settings, service/template IDs, quota and EmailJS history.',
  };
  const code = error instanceof AccountSetupMailError ? error.code
    : /^ER_[A-Z0-9_]{1,80}$/.test(error?.code ?? '') ? error.code : 'ACCOUNT_SETUP_OPERATION_FAILED';
  const message = hints[code] ?? (code === 'ER_BAD_FIELD_ERROR'
    ? 'A database column is missing; verify the account-invitations migration on the configured database.'
    : 'Could not prepare password recovery; check database availability and installed schema.');
  // Construct a fresh error instead of logging SQL, submitted emails, tokens,
  // request bodies, provider responses or the original error's cause/stack.
  const safe = new Error(message + (error instanceof AccountSetupMailError && error.httpStatus ? ` HTTP ${error.httpStatus}.` : ''));
  safe.code = code;
  reportError(context, safe);
}

// Caller owns the transaction and locks the user first. Keep only a digest in
// MySQL; the plaintext secret exists briefly in memory for its intended email.
export async function prepareAccountSetup(connection, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const invitation = Boolean(Number(user.password_setup_required));
  await connection.execute(
    `UPDATE users SET password_setup_token_hash = ?, password_setup_expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE), password_setup_sent_at = NOW(), temp_password_jti = NULL WHERE id = ?`,
    [digest(token), invitation ? 1440 : 30, user.id],
  );
  return { to: user.email, username: user.username, token, invitation };
}

// A delivery failure is separate from a committed account/token write. Never
// report that account creation failed or return the secret to the administrator.
export async function deliverAccountSetup(job) {
  try { await sendAccountSetupEmail(job); return true; }
  catch (error) { reportSetupFailure('Account setup email delivery failed:', error); return false; }
}

export async function resendAccountInvitation(req, res) {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [[user]] = await connection.execute(
      `SELECT id, email, username, status, deleted_at, password_setup_required,
       (password_setup_sent_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)) AS cooldown
       FROM users WHERE id = ? FOR UPDATE`, [req.params.accountId]);
    if (!user || user.status !== 'active' || user.deleted_at || !Number(user.password_setup_required)) {
      await connection.rollback();
      return res.status(409).json({ error: 'Only active accounts awaiting password setup can receive an invitation.' });
    }
    if (Number(user.cooldown)) {
      await connection.rollback();
      return res.status(429).json({ error: 'Please wait one minute before resending this invitation.' });
    }
    const job = await prepareAccountSetup(connection, user);
    await connection.execute(
      `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description) VALUES (?, ?, 'account_invitation_resent', 'users', ?, ?)`,
      [req.verifiedUser.id, req.verifiedUser.role, user.id, `Requested a new account setup invitation for ${user.username}.`]);
    await connection.commit();
    connection.release(); connection = null;
    invalidateActivityLogsCache(); invalidateRouteCache('/api/v1/accounts');
    const sent = await deliverAccountSetup(job);
    return res.json({ success: sent, prepared: true, invitation_sent: sent,
      ...(sent ? { message: 'Invitation sent. Earlier setup links are no longer valid.' } : { error: 'The invitation email could not be confirmed. Check the email configuration and try again after one minute.' }) });
  } catch {
    if (connection) await connection.rollback();
    return res.status(500).json({ error: 'Could not prepare the invitation. Refresh before trying again.' });
  } finally { connection?.release(); }
}

// A generic recovery response covers both pending onboarding and existing users.
// Issuing a reset link does not disable an existing password or existing sessions.
export async function requestPasswordSetup(req, res) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const generic = { message: 'If that email is registered, password setup instructions have been sent.' };
  let connection, job;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [[user]] = await connection.execute(
      `SELECT id, email, username, status, deleted_at, password_setup_required,
       (password_setup_sent_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)) AS cooldown
       FROM users WHERE email = ? FOR UPDATE`, [email]);
    if (!user || user.status !== 'active' || user.deleted_at || Number(user.cooldown)) {
      await connection.rollback(); return res.json(generic);
    }
    job = await prepareAccountSetup(connection, user);
    await connection.commit();
    connection.release(); connection = null;
    await deliverAccountSetup(job);
    return res.json(generic);
  } catch (error) {
    reportSetupFailure('Password recovery preparation failed:', error);
    if (connection) {
      try { await connection.rollback(); }
      catch (rollbackError) { reportSetupFailure('Password recovery rollback failed:', rollbackError); }
    }
    return res.json(generic);
  } finally { connection?.release(); }
}

export async function completeAccountSetup(req, res) {
  const { token, newPassword, confirmPassword } = req.body ?? {};
  res.set?.('Cache-Control', 'private, no-store');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: invalidLink });
  if (typeof newPassword !== 'string' || newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > 72 || looksLikeJwt(newPassword)) {
    return res.status(400).json({ error: 'Use at least 8 characters and at most 72 UTF-8 bytes, without the temporary-code format.' });
  }
  if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    // Locking the user serializes completion against another completion, resend,
    // deactivation and recovery. GET requests and email scanners never consume it.
    const [[user]] = await connection.execute(
      `SELECT u.id, u.username, u.password_setup_required, r.role FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.password_setup_token_hash = ? AND u.password_setup_expires_at > NOW()
       AND u.status = 'active' AND u.deleted_at IS NULL FOR UPDATE`, [digest(token)]);
    if (!user) { await connection.rollback(); return res.status(400).json({ error: invalidLink }); }
    const hash = await bcrypt.hash(newPassword, 10);
    const [updated] = await connection.execute(
      `UPDATE users SET password_hash = ?, password_changed_at = NOW(), password_setup_required = 0,
       password_setup_token_hash = NULL, password_setup_expires_at = NULL, temp_password_jti = NULL,
       failed_login_attempts = 0, account_locked_until = NULL
       WHERE id = ? AND password_setup_token_hash = ? AND password_setup_expires_at > NOW()`, [hash, user.id, digest(token)]);
    if (updated.affectedRows !== 1) { await connection.rollback(); return res.status(400).json({ error: invalidLink }); }
    await connection.execute(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL`, [user.id]);
    await connection.execute(
      `INSERT INTO activity_logs (actor_id, actor_role, action, target_type, target_id, description) VALUES (?, ?, ?, 'users', ?, ?)`,
      [user.id, user.role, Number(user.password_setup_required) ? 'account_setup_completed' : 'password_reset', user.id,
        `${Number(user.password_setup_required) ? 'Completed account setup' : 'Reset the password'} for ${user.username}.`]);
    await connection.commit();
    connection.release(); connection = null;
    invalidateUserCache(user.id); invalidateRouteCache('/api/v1/accounts'); invalidateActivityLogsCache();
    return res.json({ success: true, message: 'Password saved. Sign in with your username and new password.' });
  } catch {
    if (connection) await connection.rollback();
    return res.status(500).json({ error: 'Could not confirm the password change. Try signing in before requesting another link.' });
  } finally { connection?.release(); }
}
