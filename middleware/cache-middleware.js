import cache, { getCacheGeneration } from "../config/cache.js";

const MAX_BODY_BYTES = 256 * 1024;

/** Opt-in JSON GET cache. Mount AFTER authentication, authorization and limits. */
export function cacheRoute(ttlSeconds = 60) {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new TypeError("Cache TTL must be a positive number of seconds");
  }

  return (req, res, next) => {
    const user = req.verifiedUser;
    if (req.method !== "GET" || user?.id == null || !user.role) return next();

    // This is server-side caching, not permission for browsers/proxies to
    // retain private profiles after logout or an account switch.
    res.set("Cache-Control", "private, no-store");
    if (process.env.CACHE_ENABLED === "false") return next();

    const userId = String(user.id);
    const path = req.originalUrl.split("?")[0];
    const key = JSON.stringify([
      userId, user.role, user.username, user.department_id, user.course_id,
      user.department_code, user.course_name, req.originalUrl,
    ]);
    try {
      const cached = cache.get(key);
      if (cached !== undefined) return res.status(200).json(cached.body);
    } catch {
      // A cache failure must not prevent the database-backed response.
      return next();
    }

    const generation = getCacheGeneration();
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (
        res.statusCode === 200 && !res.locals.skipCache &&
        !res.getHeader("Set-Cookie") && generation === getCacheGeneration()
      ) {
        try {
          const serialized = JSON.stringify(body);
          if (serialized !== undefined && Buffer.byteLength(serialized) <= MAX_BODY_BYTES) {
            cache.set(key, { userId, path, body: JSON.parse(serialized) }, ttlSeconds);
          }
        } catch {
          // Full cache, unsupported JSON or store error: serve normally.
        }
      }
      return originalJson(body);
    };
    return next();
  };
}
