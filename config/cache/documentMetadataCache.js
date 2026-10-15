import { invalidateInternshipOverviewsCache } from "./profileOverviewCache.js";
import cache, { invalidateRouteCache } from "./cache.js";
const ownPath = "/eu-connect/api/internships/files";
const families = ["/eu-connect/api/searched-user/files/", "/eu-connect/api/searched-user/employer-uploaded-files/", "/eu-connect/api/internship-records/documents/"];
export function invalidateDocumentMetadataCache() {
  invalidateInternshipOverviewsCache();
  // Always advance the generation, even when no entry exists yet.
  invalidateRouteCache(ownPath);
  const paths = new Set();
  for (const key of cache.keys()) {
    const path = cache.get(key)?.path;
    if (typeof path === "string" && families.some(prefix => path.startsWith(prefix) && path.slice(prefix.length).length > 0 && !path.slice(prefix.length).includes("/"))) paths.add(path);
  }
  for (const path of paths) invalidateRouteCache(path);
}
