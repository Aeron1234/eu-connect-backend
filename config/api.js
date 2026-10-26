export const API_PREFIX = "/api/v1";
export const LEGACY_API_PREFIX = "/eu-connect/api";
export const API_PREFIXES = Object.freeze([API_PREFIX, LEGACY_API_PREFIX]);

/** Give aliases one identity without changing resource paths or query values. */
export function canonicalApiPath(value) {
  if (typeof value !== "string") return value;
  // Only prefix matching ignores case. Preserve the resource path and query verbatim;
  // the boundary check avoids rewriting unrelated paths such as /api/v10.
  const lower = value.toLowerCase();
  for (const prefix of API_PREFIXES) {
    if (
      lower.startsWith(prefix) &&
      (value.length === prefix.length ||
        ["/", "?"].includes(value[prefix.length]))
    ) {
      return API_PREFIX + value.slice(prefix.length);
    }
  }
  return value;
}

/**
 * Reuse handlers and limiter instances at both aliases; canonical keys share budgets.
 */
export function mountApiRoutes(app, routes) {
  app.use(API_PREFIXES, ...routes);
}
