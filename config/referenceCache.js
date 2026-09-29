import { invalidateDocumentMetadataCache } from "./documentMetadataCache.js";
import { invalidateRouteCache } from "./cache.js";

// No current mutation endpoints. Future writers must call these after commit.
export function invalidateRegionsCache() {
  invalidateRouteCache("/eu-connect/api/regions");
}
export function invalidateRequirementTypesCache() {
  invalidateDocumentMetadataCache();
  invalidateRouteCache("/eu-connect/api/internships/files/requirements");
}
