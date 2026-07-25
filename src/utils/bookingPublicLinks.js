/**
 * Public customer-booking URLs (no auth). IDs come from booking_types / booking_activities.
 * No separate "link record" is stored — links are always derived from business + id.
 */

export function getCustomerPortalBaseUrl(origin, businessId) {
  if (!origin || !businessId) return '';
  return `${String(origin).replace(/\/$/, '')}/customer-portal/${businessId}/portal`;
}

/** Opens main portal with the booking category (booking_types row) pre-selected in the sidebar. */
export function getCategoryPortalUrl(origin, businessId, typeId) {
  const base = getCustomerPortalBaseUrl(origin, businessId);
  if (!base || !typeId) return base;
  return `${base}?type=${encodeURIComponent(typeId)}`;
}

/** Opens the activity flow directly (booking_activities id is the route segment). */
export function getActivityPortalUrl(origin, businessId, activityId) {
  if (!origin || !businessId || !activityId) return '';
  return `${String(origin).replace(/\/$/, '')}/customer-portal/${businessId}/portal/${encodeURIComponent(activityId)}`;
}
