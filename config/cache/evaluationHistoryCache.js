import { canonicalApiPath } from "../api.js";
import cache, { invalidateRouteCache } from "./cache.js";
// Invalidate evaluation lists and cached student/record histories in this process.
// Include legacy list names because old cache entries may still use those route families.
export function invalidateEvaluationHistoryCache() {
  for (const route of ["/evaluations/all", "/evaluations/disputed", "/evaluations/submitted"]) invalidateRouteCache("/api/v1" + route);
  const families = ["/api/v1/student-past-evaluations/", "/api/v1/internship-records/evaluations/"];
  const paths = new Set();
  for (const key of cache.keys()) {
    const path = canonicalApiPath(cache.get(key)?.path);
    if (typeof path === "string" && families.some(prefix => path.startsWith(prefix) && path.slice(prefix.length).length > 0 && !path.slice(prefix.length).includes("/"))) paths.add(path);
  }
  for (const path of paths) invalidateRouteCache(path);
}
