import { invalidateDashboardCache } from "./dashboardCache.js";
import { invalidateRouteCache } from "./cache.js";

export function invalidatePostingsCache() {
  invalidateDashboardCache();
  // Content/course/status changes affect every filter, page and owner list.
  invalidateRouteCache("/api/v1/internship-postings");
  invalidateRouteCache("/api/v1/posted-jobs");
}

export function invalidatePostingFavoritesCache(studentId) {
  invalidateDashboardCache(studentId);
  // Both the flags and favorited/not_favorited list membership change.
  invalidateRouteCache("/api/v1/internship-postings", studentId);
}
