/**
 * Merged with `waiver_signatures` in the dashboard. Detail route uses this prefix in the :waiverId param.
 */
export const LEGACY_WAIVER_ID_PREFIX = 'legacy-';

/**
 * Canonical dashboard id for maps/sorting: lowercases UUID tails so `legacy-${uuid}` matches
 * across Supabase/JS string variants and `waiver_signatures.id` / `legacy_waivers.id`.
 */
export function normalizeDashboardWaiverId(waiverId) {
  if (waiverId == null || waiverId === '') return '';
  const s = String(waiverId).trim();
  const lower = s.toLowerCase();
  if (lower.startsWith(LEGACY_WAIVER_ID_PREFIX)) {
    return LEGACY_WAIVER_ID_PREFIX + lower.slice(LEGACY_WAIVER_ID_PREFIX.length);
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lower)) {
    return lower;
  }
  return s;
}

export function isLegacyWaiverId(waiverId) {
  if (waiverId == null || waiverId === '') return false;
  const n = normalizeDashboardWaiverId(waiverId);
  return n.startsWith(LEGACY_WAIVER_ID_PREFIX);
}

/** UUID portion after `legacy-` (canonical lowercase), or null if not a legacy dashboard id. */
export function parseLegacyWaiverUuid(waiverId) {
  const n = normalizeDashboardWaiverId(waiverId);
  if (!n.startsWith(LEGACY_WAIVER_ID_PREFIX)) return null;
  return n.slice(LEGACY_WAIVER_ID_PREFIX.length);
}
