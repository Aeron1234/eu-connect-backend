import { invalidateRouteCache } from "./cache.js";

export function invalidateAnnouncementsCache() {
  // Posts, visibility changes, author names and pinning affect all pages/filters.
  invalidateRouteCache("/api/v1/announcements/history");
}

// No category mutation endpoint exists yet. Future writers must call this
// after commit because category names/colors also appear in announcement rows.
export function invalidateAnnouncementCategoriesCache() {
  invalidateRouteCache("/api/v1/announcements/categories");
  invalidateAnnouncementsCache();
}
