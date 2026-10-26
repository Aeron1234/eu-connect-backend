import { verifyAccessToken } from "../config/jwt.js";

// Prefer a non-empty Bearer token, otherwise read the access_token cookie.
// This middleware verifies the JWT and exposes its claims without querying
// current account/department state. Route-specific guards enforce ownership
// and any membership checks that must reflect current database records.
export function verifyUser(req, res, next) {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  const token = bearerToken || req.cookies?.access_token;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const payload = verifyAccessToken(token);

    req.verifiedUser = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      course_id: payload.course_id ?? null,
      course_name: payload.course_name ?? null,
      department_id: payload.department_id ?? null,
      department_code: payload.department_code ?? null,
    };

    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired access token" });
  }
}
