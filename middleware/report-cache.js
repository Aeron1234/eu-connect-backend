import { cacheRoute } from "./cache-middleware.js";

const cacheReport = cacheRoute(60);
// Called only after controller validation and database-backed Registrar access.
// cacheRoute calls next synchronously on a miss/bypass; a hit sends the response.
export function reportCacheHit(req, res) {
  let missed = false;
  cacheReport(req, res, () => { missed = true; });
  return !missed;
}
