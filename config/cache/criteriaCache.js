import { invalidateDashboardCache } from "./dashboardCache.js";
import { invalidateRouteCache } from "./cache.js";

const routesByTable = {
  employer_evaluation_criteria: [
    "/eu-connect/api/criteria/employer-evaluation",
    "/eu-connect/api/evaluation-criterias",
  ],
  student_evaluation_criteria: [
    "/eu-connect/api/criteria/student-evaluation",
    "/eu-connect/api/student-evaluation/criteria",
  ],
};

// A criteria change affects both the admin list (including inactive variants)
// and the active evaluation form. Keep the other criteria family cached.
export function invalidateCriteriaCache(tableName) {
  invalidateDashboardCache();
  for (const route of routesByTable[tableName]) invalidateRouteCache(route);
}
