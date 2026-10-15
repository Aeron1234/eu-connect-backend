import { invalidateInternshipOverviewsCache } from "./profileOverviewCache.js";
import cache, { invalidateRouteCache } from "./cache.js";
export function invalidateWeeklyNarrativesCache() {
  invalidateInternshipOverviewsCache();
  // Advance generation even when entries do not yet exist.
  invalidateRouteCache("/eu-connect/api/weekly-narratives/history");
  const families = ["/eu-connect/api/searched-user/weekly-narratives/", "/eu-connect/api/internship-records/weekly-narratives/"];
  const paths = new Set();
  for (const key of cache.keys()) {
    const path = cache.get(key)?.path;
    if (typeof path === "string" && families.some(prefix => path.startsWith(prefix) && path.slice(prefix.length).length > 0 && !path.slice(prefix.length).includes("/"))) paths.add(path);
  }
  for (const path of paths) invalidateRouteCache(path);
}
