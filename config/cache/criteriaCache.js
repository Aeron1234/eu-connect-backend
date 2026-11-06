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

// Clear legacy response-cache entries for the changed criteria family. Current
// department/target-scoped endpoints bypass the response cache entirely.
export function invalidateCriteriaCache(tableName) {
  invalidateDashboardCache();
  for (const route of routesByTable[tableName]) invalidateRouteCache(route);
}
