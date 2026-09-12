import { verifyAccessToken } from "../config/jwt.js";

// Accepts the token from either source:
// - Authorization: Bearer <token>  — how Next.js server actions call this API
// - the access_token cookie        — how a real browser (or Postman) calling
//                                     this API directly would send it
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
