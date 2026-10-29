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

// toSessionUser() in features/auth/controllers/authControllers.js supplies
// identity and role context. Include IDs for backend scoping and labels/codes
// for frontend display. Claims are issuance-time snapshots; sensitive reads
// that require current membership must query it separately.
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

// Recovery credentials can authorize only password setup, never normal APIs.
export function signPasswordSetupToken(userId, jti) {
  return jwt.sign(
    { sub: userId, jti, purpose: "password_setup" },
    ACCESS_TOKEN_SECRET,
    { expiresIn: "10m" },
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

// The signed token itself is the temporary login credential; no separate
// temporary plaintext password is stored. Login verifies it with this secret
// and matches its subject/JTI to the account's stored temporary identifier.
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

// Persist a SHA-256 digest for refresh-token equality checks, rather than the
// reusable token value. Normal account passwords use bcrypt in the controller.
export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Three dot-separated parts select the temporary-credential login branch.
// This is only a shape test, not JWT verification; an ordinary password with
// that shape is routed through the same temporary-token check.
export function looksLikeJwt(value) {
  return typeof value === "string" && value.split(".").length === 3;
}
