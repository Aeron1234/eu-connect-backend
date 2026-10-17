import { invalidateDashboardCache } from "./dashboardCache.js";
import { invalidateRouteCache } from "./cache.js";

const routesByTable = {
  employer_evaluation_criteria: [
    "/api/v1/criteria/employer-evaluation",
    "/api/v1/evaluation-criterias",
  ],
  student_evaluation_criteria: [
    "/api/v1/criteria/student-evaluation",
    "/api/v1/student-evaluation/criteria",
  ],
};

// A criteria change affects both the admin list (including inactive variants)
// and the active evaluation form. Keep the other criteria family cached.
export function invalidateCriteriaCache(tableName) {
  invalidateDashboardCache();
  for (const route of routesByTable[tableName]) invalidateRouteCache(route);
}
