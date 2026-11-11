import { canonicalApiPath } from "../api.js";
import NodeCache from "node-cache";
import { recordCacheMetric } from "./cacheMetrics.js";

// Process-local only. Disable when running multiple API workers until a
// shared store and cross-worker invalidation are available.
const cache = new NodeCache({
  stdTTL: 60,
  checkperiod: 60,
  useClones: true,
  maxKeys: 1000,
});

cache.on("expired", () => recordCacheMetric("expired_entries"));
cache.on("flush", () => recordCacheMetric("flushes"));

let generation = 0;
export const getCacheGeneration = () => generation;

function invalidateMatching(matches) {
  // Advance the global generation even when no entries match. Every older
  // in-flight cache miss must skip storing; its response still reaches the caller.
  // Entry deletion below remains limited to the matching user or route.
  generation += 1;
  recordCacheMetric("invalidation_calls");
  for (const key of cache.keys()) {
    const entry = cache.get(key);
    if (entry && matches(entry)) {
      recordCacheMetric("invalidated_entries", undefined, cache.del(key));
    }
  }
}

export function invalidateUserCache(userId) {
  invalidateMatching((entry) => entry.userId === String(userId));
}

export function invalidateRouteCache(path, userId) {
  // Match the canonical path across cached query variants, optionally for one user.
  // Callers supply a path without a query; nested resource paths are separate.
  const canonicalPath = canonicalApiPath(path);
  invalidateMatching((entry) => canonicalApiPath(entry.path) === canonicalPath &&
    (userId === undefined || entry.userId === String(userId)));
}

export default cache;

// Retention can remove entire internship trees used by many cached reports.
export function invalidateAllResponseCache() {
  generation += 1;
  cache.flushAll();
}
