import { cacheRoute } from "./cache-middleware.js";
const cacheMetadata = cacheRoute(30);
// Call only after verifyRecordAccess, including on cache hits.
export function documentMetadataCacheHit(req, res) {
  let missed = false;
  cacheMetadata(req, res, () => { missed = true; });
  return !missed;
}
