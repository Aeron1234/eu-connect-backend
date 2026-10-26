import { invalidateRouteCache } from "./cache.js";

// Invalidate personal past-internship reads for the supplied user; omitted identity follows
// invalidateRouteCache's route-wide behavior. This does not clear another server's memory.
export function invalidatePastInternshipsCache(userId) {
  invalidateRouteCache("/api/v1/internships/my-past-internships", userId);
}
