import { invalidateDocumentMetadataCache } from "./documentMetadataCache.js";
import { invalidateRouteCache } from "./cache.js";

// No current mutation endpoints. Future writers must call these after commit.
export function invalidateRegionsCache() {
  invalidateRouteCache("/api/v1/regions");
}
export function invalidateRequirementTypesCache() {
  invalidateDocumentMetadataCache();
  invalidateRouteCache("/api/v1/internships/files/requirements");
}
