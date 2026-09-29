import { invalidateRouteCache } from "./cache.js";

export function invalidateHteReportsCache() {
  for (const path of ["/reports/academic-years", "/reports/hte-annual/companies", "/reports/hte-annual/company"]) {
    invalidateRouteCache("/eu-connect/api" + path);
  }
}
export function invalidateAnnualReportsCache() {
  invalidateRouteCache("/eu-connect/api/reports/annex-c");
}
