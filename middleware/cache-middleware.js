import { canonicalApiPath } from "../config/api.js";
import cache, { getCacheGeneration } from "../config/cache/cache.js";
import { cacheMetricRoute, recordCacheMetric } from "../config/cache/cacheMetrics.js";

const MAX_BODY_BYTES = 256 * 1024;

/** Opt-in JSON GET cache. Mount AFTER authentication, authorization and limits. */
export function cacheRoute(ttlSeconds = 60) {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new TypeError("Cache TTL must be a positive number of seconds");
  }

  return (req, res, next) => {
    const route = cacheMetricRoute(req);
    const metric = (event) => recordCacheMetric(event, route);
    const user = req.verifiedUser;
    if (req.method !== "GET") { metric("bypass_method"); return next(); }
    if (user?.id == null || !user.role) { metric("bypass_identity"); return next(); }

    // This is server-side caching, not permission for browsers/proxies to
    // retain private profiles after logout or an account switch.
    res.set("Cache-Control", "private, no-store");
    if (process.env.CACHE_ENABLED === "false") { metric("bypass_disabled"); return next(); }

    const userId = String(user.id);
    const originalUrl = canonicalApiPath(req.originalUrl);
    const path = originalUrl.split("?")[0];
    // Partition by verified viewer attributes and the full canonical URL.
    // Query values and ordering remain part of the key; aliases share a prefix.
    const key = JSON.stringify([
      userId, user.role, user.username, user.department_id, user.course_id,
      user.department_code, user.course_name, originalUrl,
    ]);
    try {
      const cached = cache.get(key);
      if (cached !== undefined) { metric("hit"); return res.status(200).json(cached.body); }
      metric("miss");
    } catch {
      metric("read_error");
      // A cache failure must not prevent the database-backed response.
      return next();
    }

    // Snapshot the process-wide generation before the controller runs. Any intervening
    // invalidation prevents this read from repopulating the cache, even for another route.
    const generation = getCacheGeneration();
    const originalJson = res.json.bind(res);
    // Store only successful, cookie-free JSON within the size limit. Opt-outs and
    // generation changes bypass storage without changing the outgoing response.
    res.json = (body) => {
      if (res.statusCode !== 200) metric("skip_status");
      else if (res.locals.skipCache) metric("skip_opt_out");
      else if (res.getHeader("Set-Cookie")) metric("skip_cookie");
      else if (generation !== getCacheGeneration()) metric("skip_generation");
      else {
        let serialized;
        try { serialized = JSON.stringify(body); }
        catch { metric("skip_serialization"); return originalJson(body); }
        if (serialized === undefined) metric("skip_serialization");
        else if (Buffer.byteLength(serialized) > MAX_BODY_BYTES) metric("skip_oversized");
        else {
          try {
            const stored = cache.set(
              key,
              // Keep a JSON snapshot plus metadata used by user/path invalidation.
              { userId, path, body: JSON.parse(serialized) },
              ttlSeconds,
            );
            metric(stored ? "store" : "write_error");
          } catch {
            // Cache failures must never prevent the normal response.
            metric("write_error");
          }
        }
      }
      return originalJson(body);
    };
    return next();
  };
}
