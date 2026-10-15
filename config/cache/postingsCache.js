import { invalidateDashboardCache } from "./dashboardCache.js";
import { invalidateRouteCache } from "./cache.js";

export function invalidatePostingsCache() {
  invalidateDashboardCache();
  // Content/course/status changes affect every filter, page and owner list.
  invalidateRouteCache("/eu-connect/api/internship-postings");
  invalidateRouteCache("/eu-connect/api/posted-jobs");
}

export function invalidatePostingFavoritesCache(studentId) {
  invalidateDashboardCache(studentId);
  // Both the flags and favorited/not_favorited list membership change.
  invalidateRouteCache("/eu-connect/api/internship-postings", studentId);
}
