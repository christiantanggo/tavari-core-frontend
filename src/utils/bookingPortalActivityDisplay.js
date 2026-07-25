export function parseActivityTicketSettings(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? raw : {};
}

export function parseActivityDescriptionLines(description) {
  const text = String(description || '').trim();
  if (!text) return [];
  if (text.includes('·')) {
    return text
      .split('·')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [text];
}

/** Customer portal copy comes from booking_activity_sections — not booking_activities.description. */
export function getActivityDisplayLines(_activity) {
  return [];
}

export function normalizeActivityImageUrls(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((url) => (typeof url === 'string' ? url.trim() : ''))
    .filter(Boolean);
}

export function resolveActivityImageUrls(activity, catalogActivity = null) {
  const ticketSettings = parseActivityTicketSettings(activity?.ticket_settings);
  const fromActivity = normalizeActivityImageUrls(activity?.images);
  if (fromActivity.length > 0) return fromActivity.slice(0, 3);

  const fromTicketSettings = normalizeActivityImageUrls(ticketSettings.activity_images);
  if (fromTicketSettings.length > 0) return fromTicketSettings.slice(0, 3);

  const fromCatalog = normalizeActivityImageUrls(catalogActivity?.images);
  if (fromCatalog.length > 0) return fromCatalog.slice(0, 3);

  if (catalogActivity?.imageUrl) {
    return [String(catalogActivity.imageUrl).trim()].filter(Boolean);
  }

  return [];
}

export function mergePortalActivityWithCatalog(activity, catalogActivity = null) {
  if (!catalogActivity) return activity;

  return {
    ...activity,
    website_package_inclusions:
      activity?.website_package_inclusions ??
      (Array.isArray(catalogActivity.inclusions) ? catalogActivity.inclusions : activity?.website_package_inclusions),
  };
}
