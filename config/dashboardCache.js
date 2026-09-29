import { invalidateRouteCache } from "./cache.js";

const routes = [
  "/dashboard-stats", "/employer-dashboard-stats", "/employer-dashboard-data",
  "/department-head-dashboard-stats", "/department-head-dashboard-data",
  "/average-shift-hours", "/admin-dashboard-stats", "/admin-dashboard-data",
];

// Cross-role aggregates have many dependencies: conservatively clear all
// summary routes after shared writes. Personal counters can target one user.
export function invalidateDashboardCache(userId) {
  for (const route of routes) invalidateRouteCache(`/eu-connect/api${route}`, userId);
}
