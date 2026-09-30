import { cacheRoute } from "./cache-middleware.js";
const cacheOverview = cacheRoute(30);
// Must follow verifyRecordAccess, including on hits.
export function internshipOverviewCacheHit(req, res) {
  let missed = false;
  cacheOverview(req, res, () => { missed = true; });
  return !missed;
}
