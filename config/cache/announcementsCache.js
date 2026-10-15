import { invalidateRouteCache } from "./cache.js";

export function invalidateAnnouncementsCache() {
  // Posts, visibility changes, author names and pinning affect all pages/filters.
  invalidateRouteCache("/eu-connect/api/announcements/history");
}

// No category mutation endpoint exists yet. Future writers must call this
// after commit because category names/colors also appear in announcement rows.
export function invalidateAnnouncementCategoriesCache() {
  invalidateRouteCache("/eu-connect/api/announcements/categories");
  invalidateAnnouncementsCache();
}
