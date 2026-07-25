/**
 * Default list/search excludes soft-archived waivers (expired 2+ years).
 * - includeArchived + search: also queries archived legacy_waivers and waiver_signatures (2+ years).
 * - archivedOnly: archived rows only (used for that second query).
 */
export function applyWaiverArchiveFilter(query, filters = {}) {
  if (filters.archivedOnly === true) {
    return query.not('archived_at', 'is', null);
  }
  if (filters.includeArchived === true) {
    return query;
  }
  return query.is('archived_at', null);
}
