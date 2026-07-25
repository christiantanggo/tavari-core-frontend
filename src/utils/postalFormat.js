/** Strip to alphanumeric only, uppercase (Canadian postal code). */
export function stripPostalChars(value) {
  return String(value ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

/**
 * Format a Canadian postal code for display: A1A 1A1
 * Accepts mixed case, with or without a space.
 */
export function formatPostalCodeDisplay(value) {
  const raw = stripPostalChars(value).slice(0, 6);
  if (!raw) return '';
  if (raw.length <= 3) return raw;
  return `${raw.slice(0, 3)} ${raw.slice(3)}`;
}

/** Format while typing in a postal code input field. */
export function formatPostalCodeInput(value) {
  return formatPostalCodeDisplay(value);
}
