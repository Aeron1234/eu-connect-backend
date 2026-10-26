import { canonicalApiPath } from "../api.js";
import cache, { invalidateRouteCache } from "./cache.js";
// Invalidate attendance history plus cached searched-user/record DTR routes in this process.
// Canonicalize aliases and match one identifier segment to avoid unrelated descendant routes.
export function invalidateAttendanceHistoryCache() {
  invalidateRouteCache("/api/v1/dtr/history");
  const families = ["/api/v1/searched-user/dtrs/", "/api/v1/internship-records/dtr/"];
  const paths = new Set();
  for (const key of cache.keys()) {
    const path = canonicalApiPath(cache.get(key)?.path);
    if (typeof path === "string" && families.some(prefix => path.startsWith(prefix) && path.slice(prefix.length).length > 0 && !path.slice(prefix.length).includes("/"))) paths.add(path);
  }
  for (const path of paths) invalidateRouteCache(path);
}
