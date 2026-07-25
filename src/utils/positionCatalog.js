/** Canonical HR route for Position Management (same tab as PositionsTab). */
export const HR_POSITION_MANAGEMENT_PATH = '/dashboard/hr/employee-management?tab=position-management';

export function positionRowsToNameSet(rows) {
  const set = new Set();
  (rows || []).forEach((r) => {
    if (r?.position_name) set.add(String(r.position_name).trim());
  });
  return set;
}

/**
 * Display stored position strings against the HR catalog.
 * Values not in knownNames → "Unknown". Empty → "".
 * Pass knownNames=null to show raw (e.g. catalog not loaded yet).
 */
export function formatPositionDisplay(raw, knownNames) {
  if (raw == null || String(raw).trim() === '') return '';
  const s = String(raw).trim();
  // Catalog not loaded yet, or RLS returned no rows — show stored value instead of "Unknown".
  if (!knownNames || knownNames.size === 0) return s;
  if (knownNames.has(s)) return s;
  return 'Unknown';
}
