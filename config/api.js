export const API_PREFIX = "/api/v1";
export const LEGACY_API_PREFIX = "/eu-connect/api";
export const API_PREFIXES = Object.freeze([API_PREFIX, LEGACY_API_PREFIX]);

/** Give aliases one identity without changing resource paths or query values. */
export function canonicalApiPath(value) {
  if (typeof value !== "string") return value;
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

/** Mount the same handlers and limiter instances at both prefixes during rollout. */
export function mountApiRoutes(app, routes) {
  app.use(API_PREFIXES, ...routes);
}
