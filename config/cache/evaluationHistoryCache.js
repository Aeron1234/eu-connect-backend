import cache, { invalidateRouteCache } from "./cache.js";
export function invalidateEvaluationHistoryCache() {
  for (const route of ["/evaluations/all", "/evaluations/disputed", "/evaluations/submitted"]) invalidateRouteCache("/eu-connect/api" + route);
  const families = ["/eu-connect/api/student-past-evaluations/", "/eu-connect/api/internship-records/evaluations/"];
  const paths = new Set();
  for (const key of cache.keys()) {
    const path = cache.get(key)?.path;
    if (typeof path === "string" && families.some(prefix => path.startsWith(prefix) && path.slice(prefix.length).length > 0 && !path.slice(prefix.length).includes("/"))) paths.add(path);
  }
  for (const path of paths) invalidateRouteCache(path);
}
