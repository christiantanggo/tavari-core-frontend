import { supabase } from '../../supabaseClient';

/**
 * Stable per-tab session key for funnel tracking (resets when the tab is closed).
 */
export function getBookingFunnelSessionKey(businessId, activityId) {
  if (typeof window === 'undefined' || !businessId || !activityId) return null;
  const storageKey = `tavari_booking_funnel_${businessId}_${activityId}`;
  let id = sessionStorage.getItem(storageKey);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(storageKey, id);
  }
  return id;
}

/**
 * Records progress through the customer portal booking flow (server-side tracking for abandoned-cart emails).
 */
export async function recordBookingFunnelActivity({
  businessId,
  activityId,
  sessionKey,
  stage,
  customerId,
  customerEmail,
  pendingHelcimId,
}) {
  if (!businessId || !activityId || !sessionKey || !stage) return;
  try {
    const { error } = await supabase.functions.invoke('record-booking-funnel-activity', {
      body: {
        businessId,
        activityId,
        clientSessionKey: sessionKey,
        stage,
        customerId: customerId || undefined,
        customerEmail: customerEmail || undefined,
        pendingHelcimId: pendingHelcimId || undefined,
      },
    });
    if (error) {
      console.warn('[BookingFunnelService]', error.message);
    }
  } catch (e) {
    console.warn('[BookingFunnelService]', e);
  }
}
