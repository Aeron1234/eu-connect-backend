import { cacheRoute } from "./cache-middleware.js";
const cacheHistory = cacheRoute(30);
// Invoke only after verifyRecordAccess succeeds on every request.
export function evaluationHistoryCacheHit(req, res) {
  let missed = false;
  cacheHistory(req, res, () => { missed = true; });
  return !missed;
}
