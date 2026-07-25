/**
 * Date of birth for waivers is a legal/civil calendar date only — not a moment in time.
 * Do not parse YYYY-MM-DD with `new Date("YYYY-MM-DD")`; JS treats that as UTC midnight and the
 * displayed or derived day can shift in local timezones.
 */

const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * @param {unknown} value — DB string, ISO start, etc.
 * @returns {{ y: number, m: number, d: number } | null}
 */
export function parseIsoCalendarDate(value) {
  if (value == null || value === '') return null;
  const head = String(value).trim().slice(0, 10);
  const m = head.match(ISO_DATE_ONLY);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (y < 1800 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return { y, m: mo, d };
}

/**
 * @returns {string} YYYY-MM-DD or ''
 */
export function normalizeDateOfBirthToYyyyMmDd(value) {
  const p = parseIsoCalendarDate(value);
  if (!p) return '';
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/**
 * Form dropdowns / prefill (string parts).
 * @returns {{ year: string, month: string, day: string }}
 */
export function birthFormPartsFromValue(value) {
  const p = parseIsoCalendarDate(value);
  if (!p) return { year: '', month: '', day: '' };
  return {
    year: String(p.y),
    month: String(p.m).padStart(2, '0'),
    day: String(p.d).padStart(2, '0')
  };
}

/**
 * @returns {string} YYYY-MM-DD or '' if invalid
 */
export function combineBirthFormPartsToIso(year, month, day) {
  if (year == null || month == null || day == null || year === '' || month === '' || day === '') {
    return '';
  }
  const y = parseInt(String(year), 10);
  const mo = parseInt(String(month), 10);
  const d = parseInt(String(day), 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return '';
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return parseIsoCalendarDate(iso) ? iso : '';
}

/**
 * Age in full years using calendar comparison only (no UTC).
 * @param {Date} [today] — inject for tests
 * @returns {number | null}
 */
export function calculateAgeFromIsoDateOfBirth(value, today = new Date()) {
  const p = parseIsoCalendarDate(value);
  if (!p) return null;
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  let age = ty - p.y;
  if (tm < p.m || (tm === p.m && td < p.d)) age--;
  return age;
}

export function isMinorFromIsoDob(value, minorAgeThreshold = 18, today = new Date()) {
  const age = calculateAgeFromIsoDateOfBirth(value, today);
  if (age === null) return false;
  return age < minorAgeThreshold;
}

/**
 * Display DOB in a locale; calendar date only when value is YYYY-MM-DD.
 */
export function formatDateOfBirthDisplay(value, locale = 'en-US', options) {
  if (value == null || value === '') return 'N/A';
  const p = parseIsoCalendarDate(value);
  const opts = options || { year: 'numeric', month: 'long', day: 'numeric' };
  if (p) {
    const dt = new Date(p.y, p.m - 1, p.d);
    return dt.toLocaleDateString(locale, opts);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(locale, opts);
}
