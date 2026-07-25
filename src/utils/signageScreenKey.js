/** Readable screen key: 1234-5678 (digits only, dash in the middle). */

const KEY_PATTERN = /^\d{4}-\d{4}$/;
const LEGACY_KEY_PREFIX = 'screen_';

export function generateReadableScreenKey() {
  const segment = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${segment()}-${segment()}`;
}

/**
 * Accept "1234-5678" or "12345678"; leave legacy screen_* keys unchanged.
 * @param {string} raw
 */
export function normalizeScreenKeyInput(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';

  if (trimmed.startsWith(LEGACY_KEY_PREFIX)) {
    return trimmed;
  }

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length === 8) {
    return `${digitsOnly.slice(0, 4)}-${digitsOnly.slice(4)}`;
  }

  return trimmed.replace(/\s/g, '');
}

export function isValidScreenKey(key) {
  const k = String(key || '').trim();
  if (!k) return false;
  if (KEY_PATTERN.test(k)) return true;
  if (k.startsWith(LEGACY_KEY_PREFIX) && k.length >= 8) return true;
  return false;
}
