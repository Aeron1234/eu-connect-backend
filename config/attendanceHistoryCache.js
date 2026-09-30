import cache, { invalidateRouteCache } from "./cache.js";
export function invalidateAttendanceHistoryCache() {
  invalidateRouteCache("/eu-connect/api/dtr/history");
  const families = ["/eu-connect/api/searched-user/dtrs/", "/eu-connect/api/internship-records/dtr/"];
  const paths = new Set();
  for (const key of cache.keys()) {
    const path = cache.get(key)?.path;
    if (typeof path === "string" && families.some(prefix => path.startsWith(prefix) && path.slice(prefix.length).length > 0 && !path.slice(prefix.length).includes("/"))) paths.add(path);
  }
  for (const path of paths) invalidateRouteCache(path);
}
