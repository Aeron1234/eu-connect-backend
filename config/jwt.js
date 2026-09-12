import jwt from "jsonwebtoken";
import crypto from "crypto";

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;
const TEMP_PASSWORD_SECRET = process.env.TEMP_PASSWORD_SECRET;

if (!ACCESS_TOKEN_SECRET || !REFRESH_TOKEN_SECRET) {
  throw new Error(
    "ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET must be set in the environment",
  );
}

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_SECONDS * 1000;

if (!TEMP_PASSWORD_SECRET) {
  throw new Error("TEMP_PASSWORD_SECRET must be set in the environment");
}

const TEMP_PASSWORD_TTL = "10m";

// sessionUser is the shape produced by toSessionUser() in authController.js.
// Carries BOTH the numeric ids (course_id/department_id — used by backend
// controllers for scoping) and the string code/name (course_name/
// department_code — used by the Next.js frontend for display and
// page-level checks like department_code === "REG"). Same underlying row,
// both consumers, no reason to pick only one.
export function signAccessToken(sessionUser) {
  return jwt.sign(
    {
      sub: sessionUser.id,
      username: sessionUser.username,
      role: sessionUser.role,
      course_id: sessionUser.course_id ?? null,
      course_name: sessionUser.course_name ?? null,
      department_id: sessionUser.department_id ?? null,
      department_code: sessionUser.department_code ?? null,
    },
    ACCESS_TOKEN_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL },
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_TOKEN_SECRET);
}

export function signRefreshToken(userId, jti) {
  return jwt.sign({ sub: userId, jti }, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_TOKEN_SECRET);
}

export function newJti() {
  return crypto.randomUUID();
}

// The token IS the temp password — there's no separate plaintext to
// generate or hash. Whatever the user pastes into the login form gets
// checked here: if it verifies against this secret, has the right
// purpose, and its jti matches what's on the user's row (checked in the
// controller), it's a valid one-time credential.
export function signTempPassword(userId, jti) {
  return jwt.sign(
    { sub: userId, jti, purpose: "temp_password" },
    TEMP_PASSWORD_SECRET,
    {
      expiresIn: TEMP_PASSWORD_TTL,
    },
  );
}

export function verifyTempPassword(token) {
  return jwt.verify(token, TEMP_PASSWORD_SECRET);
}

// Refresh tokens are high-entropy already, so a fast hash (not bcrypt) is
// fine here — this is purely so a stolen DB dump doesn't hand out live
// tokens.
export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Cheap structural check before attempting a real verify — a normal
// password is never going to contain two dots, so this lets login()
// branch to JWT verification only when it's actually worth trying,
// without the cost/noise of always attempting jwt.verify() first.
export function looksLikeJwt(value) {
  return typeof value === "string" && value.split(".").length === 3;
}
