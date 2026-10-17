import { canonicalApiPath } from "../api.js";
import { invalidateInternshipOverviewsCache } from "./profileOverviewCache.js";
import cache, { invalidateRouteCache } from "./cache.js";
const ownPath = "/api/v1/internships/files";
const families = ["/api/v1/searched-user/files/", "/api/v1/searched-user/employer-uploaded-files/", "/api/v1/internship-records/documents/"];
export function invalidateDocumentMetadataCache() {
  invalidateInternshipOverviewsCache();
  // Always advance the generation, even when no entry exists yet.
  invalidateRouteCache(ownPath);
  const paths = new Set();
  for (const key of cache.keys()) {
    const path = canonicalApiPath(cache.get(key)?.path);
    if (typeof path === "string" && families.some(prefix => path.startsWith(prefix) && path.slice(prefix.length).length > 0 && !path.slice(prefix.length).includes("/"))) paths.add(path);
  }
  for (const path of paths) invalidateRouteCache(path);
}
