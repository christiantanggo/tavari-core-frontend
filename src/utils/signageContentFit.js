/** How signage media is scaled on the player display. */
export const SIGNAGE_CONTENT_FIT_OPTIONS = [
  { value: 'contain', label: 'Fit entire image (scale down, may letterbox)' },
  { value: 'cover', label: 'Fill screen (may crop edges)' },
  { value: 'fill', label: 'Stretch to fill (may distort)' }
];

/**
 * @param {unknown} value
 * @returns {'contain'|'cover'|'fill'}
 */
export function normalizeSignageContentFit(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'cover' || v === 'fill') return v;
  return 'contain';
}

/**
 * @param {object|null|undefined} settings
 * @returns {'contain'|'cover'|'fill'}
 */
export function contentFitFromScreenSettings(settings) {
  if (!settings || typeof settings !== 'object') return 'contain';
  return normalizeSignageContentFit(settings.contentFit);
}
