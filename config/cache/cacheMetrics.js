// Counters and uptime describe this process lifetime; they reset on restart.
const startedAt = new Date().toISOString();
const started = performance.now();
const totals = {};
const routes = new Map();
const MAX_ROUTES = 128;

const events = [
  "hit",
  "miss",
  "store",
  "read_error",
  "write_error",
  "bypass_method",
  "bypass_identity",
  "bypass_disabled",
  "skip_status",
  "skip_opt_out",
  "skip_cookie",
  "skip_generation",
  "skip_oversized",
  "skip_serialization",
  "invalidation_calls",
  "invalidated_entries",
  "expired_entries",
  "flushes",
];
const validEvents = new Set(events);

// Express route templates contain no user IDs, query strings, or cache keys.
export function cacheMetricRoute(req) {
  return typeof req.route?.path === "string"
    ? req.route.path
    : "(unclassified)";
}

export function recordCacheMetric(event, route, count = 1) {
  if (!validEvents.has(event) || !Number.isFinite(count) || count <= 0) return;
  totals[event] = (totals[event] || 0) + count;
  if (route === undefined) return;

  // Bound route-label cardinality: additional labels share the (other) bucket.
  const label =
    routes.has(route) || routes.size < MAX_ROUTES ? route : "(other)";
  if (!routes.has(label)) routes.set(label, {});
  const bucket = routes.get(label);
  bucket[event] = (bucket[event] || 0) + count;
}

function withRate(counters) {
  const result = Object.fromEntries(
    events.map((event) => [event, counters[event] || 0]),
  );
  // Hit rate covers successful cache lookups only; bypasses and read errors are separate.
  // Return null until a hit or miss has been recorded.
  const lookups = result.hit + result.miss;
  return { ...result, lookups, hitRate: lookups ? result.hit / lookups : null };
}

export function getCacheMetrics() {
  return {
    startedAt,
    sampledAt: new Date().toISOString(),
    uptimeSeconds: Math.floor((performance.now() - started) / 1000),
    totals: withRate(totals),
    routes: [...routes].map(([route, counters]) => ({
      route,
      ...withRate(counters),
    })),
  };
}
