import { cacheRoute } from "./cache-middleware.js";
const cacheHistory = cacheRoute(30);
export function cacheAttendanceHistory(req, res, next) {
  return cacheHistory(req, res, () => {
    const json = res.json.bind(res);
    res.json = body => {
      const rows = Array.isArray(body) ? body : body?.dtrs;
      // Never store a response containing live/open shifts. Preserve its contents.
      if (!Array.isArray(rows) || rows.some(row => row.clock_out == null)) res.locals.skipCache = true;
      return json(body);
    };
    return next();
  });
}
// Must follow verifyRecordAccess, including on hits.
export function attendanceHistoryCacheHit(req, res) {
  let missed = false;
  cacheAttendanceHistory(req, res, () => { missed = true; });
  return !missed;
}
