import { API_PREFIXES } from "./api.js";
import { REFRESH_TOKEN_TTL_MS } from "./jwt.js";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" };
}

export function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...cookieOptions(), path: "/", maxAge: 15 * 60 * 1000,
  });
  // Keep direct clients on either prefix working throughout the migration.
  for (const prefix of API_PREFIXES) {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...cookieOptions(), path: prefix + "/auth", maxAge: REFRESH_TOKEN_TTL_MS,
    });
  }
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...cookieOptions(), path: "/" });
  for (const prefix of API_PREFIXES) {
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), path: prefix + "/auth" });
  }
}
