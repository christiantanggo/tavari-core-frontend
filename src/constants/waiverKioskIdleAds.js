/** Waiver kiosk attract-mode carousel (Digital Signage → Waiver Kiosk Images). */

export const DEFAULT_KIOSK_AD_SLIDE_SECONDS = 8;
export const MIN_KIOSK_AD_SLIDE_SECONDS = 2;
export const MAX_KIOSK_AD_SLIDE_SECONDS = 120;

export function clampKioskAdSlideSeconds(raw) {
  const fallback = DEFAULT_KIOSK_AD_SLIDE_SECONDS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  return Math.min(MAX_KIOSK_AD_SLIDE_SECONDS, Math.max(MIN_KIOSK_AD_SLIDE_SECONDS, rounded));
}

/** Refresh signed storage URLs before Supabase expiry (kiosk runs overnight). */
export const KIOSK_IDLE_AD_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;
export const KIOSK_IDLE_AD_URL_REFRESH_MS = 4 * 60 * 60 * 1000;
