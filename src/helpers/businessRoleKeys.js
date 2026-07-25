/**
 * Role keys come from role_permissions / role_templates (often snake_case).
 * Older screens used inconsistent spellings (e.g. keyholder vs key_holder).
 */

const COMPACT = (s) => String(s || '').trim().toLowerCase().replace(/_/g, '');

/** Same logical role (handles keyholder vs key_holder and casing variants). */
export function rolesAreEquivalentKeys(a, b) {
  return COMPACT(a) === COMPACT(b);
}

/** Keys used when role_permissions cannot be loaded */
export const FALLBACK_BUSINESS_ROLE_KEYS = [
  'customer',
  'employee',
  'key_holder',
  'manager',
  'admin',
  'owner',
];

/**
 * Match stored role to the spelling used in permission tables (underscore vs legacy compact).
 */
export function resolveCanonicalRoleKey(storedRole, permissionRoleKeys = []) {
  const keys = (permissionRoleKeys || []).filter(Boolean);
  const stored = storedRole || 'employee';

  if (!keys.length) return stored;

  const exact = keys.find((k) => k.toLowerCase() === String(stored).toLowerCase());
  if (exact) return exact;

  const storedCompact = COMPACT(stored);
  const fuzzy = keys.find((k) => COMPACT(k) === storedCompact);
  if (fuzzy) return fuzzy;

  return stored;
}

/** Human-facing label for badges and selects */
export function formatRoleLabel(roleKey) {
  if (roleKey == null || roleKey === '') return '';
  const k = String(roleKey).trim();
  const lower = k.toLowerCase();
  const spaced = lower.replace(/_/g, ' ');
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}
