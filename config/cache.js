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
  // Also invalidate reads that started before the write but have not finished.
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
  // Exact path match across query variants, optionally for one recipient.
  invalidateMatching((entry) => entry.path === path &&
    (userId === undefined || entry.userId === String(userId)));
}

export default cache;
