import { canonicalApiPath } from "../api.js";
import cache, { invalidateRouteCache } from "./cache.js";

// Invalidate HTE company/year projections after related committed changes in this process.
export function invalidateHteReportsCache() {
  for (const path of ["/reports/academic-years", "/reports/hte-annual/companies", "/reports/hte-annual/company"]) {
    invalidateRouteCache("/api/v1" + path);
  }
}
// Invalidate the Annex C list and already cached single-report routes across viewers.
// Enumerate concrete one-ID paths so each route's generation guard is advanced too.
export function invalidateAnnualReportsCache() {
  invalidateRouteCache("/api/v1/reports/annex-c");
  const prefix = "/api/v1/reports/annex-c/";
  const paths = new Set();
  for (const key of cache.keys()) {
    const path = canonicalApiPath(cache.get(key)?.path);
    if (typeof path === "string" && path.startsWith(prefix) && path.slice(prefix.length).length > 0 && !path.slice(prefix.length).includes("/")) paths.add(path);
  }
  for (const path of paths) invalidateRouteCache(path);
}
