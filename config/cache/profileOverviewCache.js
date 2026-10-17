import { canonicalApiPath } from "../api.js";
import cache, { invalidateRouteCache } from "./cache.js";
function invalidateFamily(prefix) {
  invalidateRouteCache(prefix.slice(0, -1)); // Advance generation even without entries.
  const paths = new Set();
  for (const key of cache.keys()) {
    const path = canonicalApiPath(cache.get(key)?.path);
    if (typeof path === "string" && path.startsWith(prefix) && path.slice(prefix.length).length > 0 && !path.slice(prefix.length).includes("/")) paths.add(path);
  }
  for (const path of paths) invalidateRouteCache(path);
}
export function invalidateSearchedProfilesCache() { invalidateFamily("/api/v1/searched-user/"); }
export function invalidateInternshipOverviewsCache() { invalidateFamily("/api/v1/internship-records/overview/"); }
export function invalidateProfileOverviewCache() {
  invalidateSearchedProfilesCache();
  invalidateInternshipOverviewsCache();
}
