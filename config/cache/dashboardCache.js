import { invalidateRouteCache } from "./cache.js";

const routes = [
  "/dashboard-stats", "/employer-dashboard-data", "/employer-dashboard/interns",
  "/department-head-dashboard-data", "/department-head-dashboard/hours-tracker",
  "/average-shift-hours",
  "/admin-dashboard-data",
];

// Cross-role aggregates have many dependencies: conservatively clear all
// summary routes after shared writes. Personal counters can target one user.
export function invalidateDashboardCache(userId) {
  for (const route of routes) invalidateRouteCache(`/api/v1${route}`, userId);
}
