import { invalidateDashboardCache } from "./dashboardCache.js";
import { invalidateRouteCache } from "./cache.js";

// Counts, filters and page boundaries can all change after a log write.
// Clear every page for both views, including reads currently in flight.
export function invalidateActivityLogsCache() {
  invalidateDashboardCache();
  invalidateRouteCache("/eu-connect/api/activity-logs");
  invalidateRouteCache("/eu-connect/api/activity-logs/mine");
}
