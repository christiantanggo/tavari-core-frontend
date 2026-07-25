// utils/helcimDeclineHelpers.js
//
// Helcim declines any transaction where the card number, cardholder name and amount
// match a transaction from the previous five minutes. The check runs on Helcim's
// servers and cannot be waived from the API — it fires even with a fresh idempotency
// key — so the only ways past it are to wait out the window or change the amount.
// https://devdocs.helcim.com/docs/suspected-duplicate-transactions

export const HELCIM_DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

export const HELCIM_DUPLICATE_DECLINE_CODE = 'suspected_duplicate';

/**
 * True when a Helcim status/error string describes the suspected duplicate decline.
 */
export function isSuspectedDuplicateDecline(text) {
  const value = String(text || '');
  if (!value) return false;
  return /duplicat/i.test(value);
}

/**
 * Render a countdown as m:ss.
 */
export function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Split a blocked total into two uneven charges. Neither half matches the blocked
 * amount, and they must differ from each other so the second tap does not trip the
 * same check, while still collecting the exact total.
 */
export function suggestDuplicateSplit(totalCents) {
  const cents = Math.round(Number(totalCents) || 0);
  if (!Number.isFinite(cents) || cents < 4) return null;

  let firstCents = Math.round(cents * 0.6);
  if (firstCents * 2 === cents) firstCents += 1;
  if (firstCents <= 0) firstCents = 1;
  if (firstCents >= cents) firstCents = cents - 1;

  return { firstCents, secondCents: cents - firstCents };
}
