import { supabase } from '../../supabaseClient';

/**
 * Returns a self-service manage/confirmation token, creating one if needed.
 */
export async function ensureBookingManageToken(businessId, bookingId, existingToken = null) {
  const trimmed = String(existingToken || '').trim();
  if (trimmed) return trimmed;
  if (!businessId || !bookingId) {
    throw new Error('Missing booking context for confirmation link');
  }

  const { data, error } = await supabase.functions.invoke('ensure-booking-manage-token', {
    body: { businessId, bookingId },
  });

  if (error || data?.error) {
    throw new Error(data?.error || error?.message || 'Could not create booking confirmation link');
  }

  const token = String(data?.token || '').trim();
  if (!token) {
    throw new Error('Could not create booking confirmation link');
  }

  return token;
}

export function buildBookingConfirmedPath(businessId, bookingId, token, extraQuery = {}) {
  const params = new URLSearchParams({ token });
  for (const [key, value] of Object.entries(extraQuery)) {
    if (value != null && value !== '') params.set(key, String(value));
  }
  return `/customer-portal/${businessId}/portal/booking-confirmed/${bookingId}?${params.toString()}`;
}
