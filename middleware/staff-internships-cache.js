import { cacheRoute } from "./cache-middleware.js";
const cacheStaffList = cacheRoute(30);
export function cacheStaffInternships(req, res, next) {
  if (!["admin", "department_head"].includes(req.verifiedUser?.role)) return next();
  return cacheStaffList(req, res, next);
}
// Must follow the database-backed department lookup, including on hits.
export function departmentInternshipsCacheHit(req, res, departmentId) {
  const scopedRequest = Object.create(req);
  scopedRequest.verifiedUser = { ...req.verifiedUser, department_id: departmentId };
  let missed = false;
  cacheStaffList(scopedRequest, res, () => { missed = true; });
  return !missed;
}
