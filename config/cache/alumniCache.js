import { invalidateRouteCache } from "./cache.js";

export function invalidateAlumniCache() {
  // The directory merges live internships and alumni; completion also inserts
  // alumni rows. Clear every user's filters/pages, including year choices.
  invalidateRouteCache("/api/v1/alumni-internships");
  invalidateRouteCache("/api/v1/company-directory");
}
