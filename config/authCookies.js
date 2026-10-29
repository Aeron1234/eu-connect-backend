import { API_PREFIXES } from "./api.js";
import { REFRESH_TOKEN_TTL_MS } from "./jwt.js";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" };
}

// Express maxAge values are milliseconds; the Next.js cookie helpers use seconds.
export function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...cookieOptions(), path: "/", maxAge: 15 * 60 * 1000,
  });
  // Issue auth-path refresh cookies for both canonical and legacy API clients.
  // Next.js separately owns the browser cookies for its server-to-server flow.
  for (const prefix of API_PREFIXES) {
    if (!refreshToken) {
      res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), path: prefix + "/auth" });
      continue;
    }
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...cookieOptions(), path: prefix + "/auth", maxAge: REFRESH_TOKEN_TTL_MS,
    });
  }
}

// Clear each cookie with the same security attributes and paths used to set it.
export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...cookieOptions(), path: "/" });
  for (const prefix of API_PREFIXES) {
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), path: prefix + "/auth" });
  }
}
