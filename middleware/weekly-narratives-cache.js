import { cacheRoute } from "./cache-middleware.js";
const cacheWeekly = cacheRoute(30);
// Call after verifyRecordAccess on every request, including hits.
export function weeklyNarrativesCacheHit(req, res) {
  let missed = false;
  cacheWeekly(req, res, () => { missed = true; });
  return !missed;
}
