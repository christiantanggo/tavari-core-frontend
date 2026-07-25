/**
 * Values stored in `customer_display_ads.ad_type` — must match the dropdown in
 * Customer Display Ads and the Postgres CHECK (idle | transaction).
 *
 * - Full-screen when register is idle → `idle`
 * - Half-width during cart / payment → `transaction`
 */
export const CUSTOMER_DISPLAY_AD_FULLSCREEN = 'idle';
export const CUSTOMER_DISPLAY_AD_HALF_SCREEN = 'transaction';

/** Coerce any DB/UI value to exactly one of the two allowed strings. */
export function normalizeCustomerDisplayAdType(raw) {
  const t = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (
    t === CUSTOMER_DISPLAY_AD_HALF_SCREEN ||
    t === 'half' ||
    t === 'half_width' ||
    t === 'half-width'
  ) {
    return CUSTOMER_DISPLAY_AD_HALF_SCREEN;
  }
  if (
    t === CUSTOMER_DISPLAY_AD_FULLSCREEN ||
    t === 'full' ||
    t === 'fullscreen' ||
    t === 'full_screen' ||
    t === 'full-screen'
  ) {
    return CUSTOMER_DISPLAY_AD_FULLSCREEN;
  }
  return CUSTOMER_DISPLAY_AD_FULLSCREEN;
}

export function isCustomerDisplayAdHalfScreen(adOrType) {
  const raw = typeof adOrType === 'object' && adOrType !== null ? adOrType.ad_type : adOrType;
  return normalizeCustomerDisplayAdType(raw) === CUSTOMER_DISPLAY_AD_HALF_SCREEN;
}
