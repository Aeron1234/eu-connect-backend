import { invalidateRouteCache } from "./cache.js";

export function invalidatePastInternshipsCache(userId) {
  invalidateRouteCache("/api/v1/internships/my-past-internships", userId);
}
