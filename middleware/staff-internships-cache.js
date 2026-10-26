import { cacheRoute } from "./cache-middleware.js";
const cacheStaffList = cacheRoute(30);
export function cacheStaffInternships(req, res, next) {
  if (!["admin", "department_head"].includes(req.verifiedUser?.role)) return next();
  return cacheStaffList(req, res, next);
}
// Must follow the database-backed department lookup, including on hits.
export function departmentInternshipsCacheHit(req, res, departmentId) {
  // Use the freshly resolved department in the cache key rather than stale token scope.
  const scopedRequest = Object.create(req);
  scopedRequest.verifiedUser = { ...req.verifiedUser, department_id: departmentId };
  // cacheRoute calls next synchronously on a miss/bypass, or sends the cached response.
  // This boolean lets the controller stop after a hit without repeating its read.
  let missed = false;
  cacheStaffList(scopedRequest, res, () => { missed = true; });
  return !missed;
}
