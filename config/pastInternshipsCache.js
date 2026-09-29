import { invalidateRouteCache } from "./cache.js";

export function invalidatePastInternshipsCache(userId) {
  invalidateRouteCache("/eu-connect/api/internships/my-past-internships", userId);
}
