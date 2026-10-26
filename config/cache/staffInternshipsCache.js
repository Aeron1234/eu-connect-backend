import { invalidateRouteCache } from "./cache.js";
// Invalidate all department-list cache variants in this process after a committed record change.
export function invalidateDepartmentInternshipsCache() {
  invalidateRouteCache("/api/v1/internship-records/department");
}
// Refresh both department and cross-department staff lists, including the active-map projection.
export function invalidateStaffInternshipsCache() {
  invalidateDepartmentInternshipsCache();
  invalidateRouteCache("/api/v1/internships/all");
  invalidateRouteCache("/api/v1/internships/active/all");
}
