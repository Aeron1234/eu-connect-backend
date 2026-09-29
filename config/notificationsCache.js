import { invalidateDashboardCache } from "./dashboardCache.js";
import { invalidateRouteCache } from "./cache.js";

// A recipient's unread count is shared across every page and scope.
// Omit userId for broadcasts and changes to joined sender/request data.
export function invalidateNotificationsCache(userId) {
  invalidateDashboardCache(userId);
  invalidateRouteCache("/eu-connect/api/notifications", userId);
}
