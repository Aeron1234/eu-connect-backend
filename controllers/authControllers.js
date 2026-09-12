import bcrypt from "bcryptjs";
import { db } from "../config/db.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  newJti,
  hashToken,
  REFRESH_TOKEN_TTL_MS,
  signTempPassword,
  verifyTempPassword,
  looksLikeJwt,
} from "../config/jwt.js";
import { sendTempPasswordEmail } from "../services/mailer.js";

const isProd = process.env.NODE_ENV === "production";

const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";

const accessCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax",
  path: "/",
  maxAge: 15 * 60 * 1000,
};

const refreshCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax",
  path: "/eu-connect/api/auth",
  maxAge: REFRESH_TOKEN_TTL_MS,
};

function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie(ACCESS_COOKIE, accessToken, accessCookieOptions);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
}

function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { path: "/" });
  res.clearCookie(REFRESH_COOKIE, { path: "/eu-connect/api/auth" });
}

// ---- DB helpers ---------------------------------------------------------
async function findUserByEmail(email) {
  const [rows] = await db.execute(
    `
    SELECT
      u.id AS user_uuid, u.username, u.email, u.status,
      u.account_locked_until, u.failed_login_attempts,
      r.role
    FROM users AS u
    INNER JOIN roles AS r ON u.role_id = r.id
    WHERE u.email = ?
    `,
    [email],
  );
  return rows[0] ?? null;
}

async function findUserByUsername(username) {
  const [rows] = await db.execute(
    `
    SELECT
      u.id AS user_uuid, u.username, u.password_hash, u.status,
      u.account_locked_until, u.failed_login_attempts,
      u.temp_password_jti,
      r.role
    FROM users AS u
    INNER JOIN roles AS r ON u.role_id = r.id
    WHERE u.username = ?
    `,
    [username],
  );
  return rows[0] ?? null;
}

async function findUserById(userId) {
  const [rows] = await db.execute(
    `
    SELECT
      u.id AS user_uuid, u.username, u.status,
      u.account_locked_until, u.failed_login_attempts,
      r.role
    FROM users AS u
    INNER JOIN roles AS r ON u.role_id = r.id
    WHERE u.id = ?
    `,
    [userId],
  );
  return rows[0] ?? null;
}

async function attachRoleContext(user) {
  if (user.role === "student") {
    const [rows] = await db.execute(
      `
      SELECT c.id AS course_id, c.course_name AS course_name,
             d.id AS department_id, d.code AS department_code
      FROM student_academic_info AS sai
      LEFT JOIN courses AS c ON c.id = sai.course_id
      LEFT JOIN departments AS d ON d.id = sai.department_id
      WHERE sai.user_id = ?
      `,
      [user.user_uuid],
    );
    if (rows.length > 0) {
      user.course_id = rows[0].course_id;
      user.course_name = rows[0].course_name;
      user.department_id = rows[0].department_id;
      user.department_code = rows[0].department_code;
    }
  }

  if (user.role === "department_head") {
    const [rows] = await db.execute(
      `
      SELECT d.id AS department_id, d.code AS department_code
      FROM dept_heads_background_info AS dhbi
      LEFT JOIN departments AS d ON d.id = dhbi.department_id
      WHERE dhbi.user_id = ?
      `,
      [user.user_uuid],
    );
    if (rows.length > 0) {
      user.department_id = rows[0].department_id;
      user.department_code = rows[0].department_code;
    }
  }
}

async function registerFailedAttempt(user) {
  const newAttempts = user.failed_login_attempts + 1;

  if (newAttempts >= 5) {
    await db.execute(
      `UPDATE users SET failed_login_attempts = ?, account_locked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE username = ?`,
      [newAttempts, user.username],
    );
  } else {
    await db.execute(
      `UPDATE users SET failed_login_attempts = ? WHERE username = ?`,
      [newAttempts, user.username],
    );
  }
}

async function clearFailedAttempts(username) {
  await db.execute(
    `UPDATE users SET failed_login_attempts = 0, account_locked_until = NULL WHERE username = ?`,
    [username],
  );
}

function toSessionUser(user) {
  return {
    id: user.user_uuid,
    username: user.username,
    role: user.role,
    course_id: user.course_id ?? null,
    course_name: user.course_name ?? null,
    department_id: user.department_id ?? null,
    department_code: user.department_code ?? null,
  };
}

async function storeRefreshToken({ jti, userId, token, req }) {
  await db.execute(
    `INSERT INTO refresh_tokens (jti, user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)`,
    [jti, userId, hashToken(token), req.get("user-agent") ?? null, req.ip],
  );
}

async function revokeAllTokensForUser(userId) {
  await db.execute(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL`,
    [userId],
  );
}

async function issueTokenPair(sessionUser, req) {
  const accessToken = signAccessToken(sessionUser);
  const jti = newJti();
  const refreshToken = signRefreshToken(sessionUser.id, jti);
  await storeRefreshToken({
    jti,
    userId: sessionUser.id,
    token: refreshToken,
    req,
  });
  return { accessToken, refreshToken };
}

// ---- controllers ----------------------------------------------------------
export const forgotPassword = async (req, res) => {
  const { email } = req.body ?? {};

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  const genericResponse = {
    message: "If that email is registered, a temporary password has been sent.",
  };

  try {
    const user = await findUserByEmail(email);
    if (!user) {
      return res.json(genericResponse);
    }

    const jti = newJti();
    const tempPasswordToken = signTempPassword(user.user_uuid, jti);

    await db.execute(`UPDATE users SET temp_password_jti = ? WHERE id = ?`, [
      jti,
      user.user_uuid,
    ]);

    await sendTempPasswordEmail({
      to: user.email,
      username: user.username,
      tempPassword: tempPasswordToken,
      expiresInMinutes: 10,
    });

    return res.json(genericResponse);
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.json(genericResponse);
  }
};

export const login = async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "username and password are required" });
  }

  try {
    const user = await findUserByUsername(username);

    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    if (
      user.account_locked_until &&
      new Date(user.account_locked_until) > new Date()
    ) {
      const formatted = new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(user.account_locked_until));

      return res.status(423).json({
        error: "account_locked",
        message: `Account locked until ${formatted}. Please try again later.`,
      });
    }

    if (user.status === "inactive") {
      return res.status(403).json({ error: "inactive_account" });
    }

    let mustChangePassword = false;

    if (looksLikeJwt(password)) {
      let payload;
      try {
        payload = verifyTempPassword(password);
      } catch {
        await registerFailedAttempt(user);
        return res.status(401).json({ error: "Invalid username or password" });
      }

      const jtiMatches =
        payload.sub === user.user_uuid &&
        user.temp_password_jti &&
        payload.jti === user.temp_password_jti;

      if (!jtiMatches) {
        await registerFailedAttempt(user);
        return res.status(401).json({ error: "Invalid username or password" });
      }

      await db.execute(
        `UPDATE users SET temp_password_jti = NULL WHERE id = ?`,
        [user.user_uuid],
      );

      mustChangePassword = true;
    } else {
      const isMatch = await bcrypt.compare(password, user.password_hash);

      if (!isMatch) {
        await registerFailedAttempt(user);
        return res.status(401).json({ error: "Invalid username or password" });
      }
    }

    await clearFailedAttempts(user.username);
    await attachRoleContext(user);

    const sessionUser = toSessionUser(user);
    const tokens = await issueTokenPair(sessionUser, req);
    setAuthCookies(res, tokens);

    return res.json({ user: sessionUser, mustChangePassword, ...tokens });
  } catch (err) {
    console.error("Login error:", err);
    return res
      .status(500)
      .json({ error: "Something went wrong. Please try again." });
  }
};

const REUSE_GRACE_MS = 10_000; // 10 seconds
const MAX_CHAIN_HOPS = 5;

async function findRefreshTokenRecord(jti) {
  const [rows] = await db.execute(
    `SELECT * FROM refresh_tokens WHERE jti = ? LIMIT 1`,
    [jti],
  );
  return rows[0] ?? null;
}

// Walks forward through the rotation chain (replaced_by_jti) to find
// whichever token is currently live, in case this jti was already
// rotated by a concurrent request a moment ago.
async function findLiveDescendant(record) {
  let current = record;
  for (let i = 0; i < MAX_CHAIN_HOPS; i++) {
    if (!current.replaced_by_jti) return null;
    const next = await findRefreshTokenRecord(current.replaced_by_jti);
    if (!next) return null;
    if (!next.revoked_at) {
      if (new Date(next.expires_at) < new Date()) return null;
      return next;
    }
    current = next;
  }
  return null;
}

export const refresh = async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];

  if (!token) {
    return res.status(401).json({ error: "No refresh token" });
  }

  let connection;
  try {
    const payload = verifyRefreshToken(token);
    const record = await findRefreshTokenRecord(payload.jti);

    if (!record || record.token_hash !== hashToken(token)) {
      clearAuthCookies(res);
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    let workingRecord = record;

    if (record.revoked_at) {
      const revokedMsAgo = Date.now() - new Date(record.revoked_at).getTime();

      // Recently revoked (likely a concurrent request that rotated this
      // same token a split second ago) — follow the chain instead of
      // nuking the session. Only treat it as genuine reuse/theft if the
      // revocation is older than the grace window.
      if (revokedMsAgo <= REUSE_GRACE_MS) {
        const live = await findLiveDescendant(record);
        if (!live) {
          await revokeAllTokensForUser(record.user_id);
          clearAuthCookies(res);
          return res
            .status(401)
            .json({ error: "Refresh token reuse detected" });
        }
        workingRecord = live;
      } else {
        await revokeAllTokensForUser(record.user_id);
        clearAuthCookies(res);
        return res.status(401).json({ error: "Refresh token reuse detected" });
      }
    }

    if (new Date(workingRecord.expires_at) < new Date()) {
      clearAuthCookies(res);
      return res.status(401).json({ error: "Refresh token expired" });
    }

    const user = await findUserById(workingRecord.user_id);

    if (!user || user.status === "inactive") {
      clearAuthCookies(res);
      return res.status(403).json({ error: "inactive_account" });
    }

    await attachRoleContext(user);
    const sessionUser = toSessionUser(user);

    const newJtiValue = newJti();
    const newRefreshToken = signRefreshToken(sessionUser.id, newJtiValue);
    const newAccessToken = signAccessToken(sessionUser);

    connection = await db.getConnection();
    await connection.beginTransaction();

    // Conditional UPDATE closes the last race window: if another
    // request rotated `workingRecord` between our SELECT and this
    // UPDATE, affectedRows will be 0 and we back off instead of
    // double-rotating the same token.
    const [updateResult] = await connection.execute(
      `UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by_jti = ? WHERE jti = ? AND revoked_at IS NULL`,
      [newJtiValue, workingRecord.jti],
    );

    if (updateResult.affectedRows === 0) {
      await connection.rollback();
      return res
        .status(409)
        .json({ error: "Token rotation in progress, please retry" });
    }

    await connection.execute(
      `INSERT INTO refresh_tokens (jti, user_id, token_hash, expires_at, user_agent, ip_address)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), ?, ?)`,
      [
        newJtiValue,
        sessionUser.id,
        hashToken(newRefreshToken),
        req.get("user-agent") ?? null,
        req.ip,
      ],
    );

    await connection.commit();

    setAuthCookies(res, {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });

    return res.json({
      user: sessionUser,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    clearAuthCookies(res);
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  } finally {
    if (connection) connection.release();
  }
};

export const logout = async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];

  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await db.execute(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE jti = ?`,
        [payload.jti],
      );
    } catch {
      // Token already invalid/expired — nothing to revoke, just clear cookies.
    }
  }

  clearAuthCookies(res);
  return res.json({ success: true });
};

export const me = (req, res) => {
  return res.json({ user: req.verifiedUser });
};

export const setPassword = async (req, res) => {
  const { newPassword } = req.body ?? {};
  const userId = req.verifiedUser.id;

  if (!newPassword || newPassword.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters." });
  }

  if (looksLikeJwt(newPassword)) {
    return res.status(400).json({
      error:
        "Password can't be in that format. Please choose a different password.",
    });
  }

  try {
    const newHash = await bcrypt.hash(newPassword, 10);

    await db.execute(
      `UPDATE users SET password_hash = ?, temp_password_jti = NULL WHERE id = ?`,
      [newHash, userId],
    );

    await revokeAllTokensForUser(userId);
    clearAuthCookies(res);

    return res.json({ success: true });
  } catch (err) {
    console.error("Set password error:", err);
    return res
      .status(500)
      .json({ error: "Something went wrong. Please try again." });
  }
};
