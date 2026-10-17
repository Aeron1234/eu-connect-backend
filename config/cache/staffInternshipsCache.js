import { invalidateRouteCache } from "./cache.js";
export function invalidateDepartmentInternshipsCache() {
  invalidateRouteCache("/api/v1/internship-records/department");
}
export function invalidateStaffInternshipsCache() {
  invalidateDepartmentInternshipsCache();
  invalidateRouteCache("/api/v1/internships/all");
  invalidateRouteCache("/api/v1/internships/active/all");
}
