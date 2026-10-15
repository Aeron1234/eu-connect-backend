import { invalidateRouteCache } from "./cache.js";
export function invalidateDepartmentInternshipsCache() {
  invalidateRouteCache("/eu-connect/api/internship-records/department");
}
export function invalidateStaffInternshipsCache() {
  invalidateDepartmentInternshipsCache();
  invalidateRouteCache("/eu-connect/api/internships/all");
  invalidateRouteCache("/eu-connect/api/internships/active/all");
}
