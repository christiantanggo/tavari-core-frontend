/** SHA-256 hex digest for vending kiosk secrets (must match Edge Function verification). */
export async function sha256Hex(plainText) {
  const encoder = new TextEncoder();
  const data = encoder.encode(String(plainText ?? ''));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const KIOSK_SHORT_CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** 6-character code for /v/{code} — easy to type on a vending machine keypad. */
export function generateKioskShortCode(length = 6) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += KIOSK_SHORT_CODE_CHARS[bytes[i] % KIOSK_SHORT_CODE_CHARS.length];
  }
  return out;
}

export function normalizeKioskShortCode(code) {
  return String(code ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '');
}

/** https://example.com/v/K7M3NP */
export function buildVendingShortKioskUrl(origin, shortCode) {
  const base = String(origin || '').replace(/\/$/, '');
  const code = normalizeKioskShortCode(shortCode);
  return `${base}/v/${code}`;
}
