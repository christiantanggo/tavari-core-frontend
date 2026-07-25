/** Shared helpers for booking Terms & Conditions acknowledgment. */

export function activityShowsTermsOnConfirmation(activityOrFlag) {
  if (typeof activityOrFlag === 'boolean') return activityOrFlag === true;
  return activityOrFlag?.terms_show_on_confirmation === true;
}

/** True when new bookings should attach pending Terms for post-booking acknowledgment. */
export function activityUsesPendingTermsOnBooking(activity) {
  return Boolean(activity?.terms_package_id) && activityShowsTermsOnConfirmation(activity);
}

export function bookingRequiresTermsAcknowledgment(booking) {
  return Boolean(booking?.terms_package_id) && booking?.terms_status === 'pending';
}

/**
 * Confirmation-page CTA: pending Terms only when the activity opted into
 * “show on booking confirmation”.
 */
export function bookingRequiresPartyTermsApprovalCta(booking, activityOrShowFlag) {
  return activityShowsTermsOnConfirmation(activityOrShowFlag)
    && bookingRequiresTermsAcknowledgment(booking);
}

export function bookingTermsAreSigned(booking) {
  return booking?.terms_status === 'signed' && Boolean(booking?.terms_signed_at);
}

export function bookingApprovalBlockedByTerms(booking) {
  return bookingRequiresTermsAcknowledgment(booking);
}

export function formatBookingTermsStatusLabel(booking) {
  if (!booking?.terms_package_id && booking?.terms_status !== 'pending' && booking?.terms_status !== 'signed') {
    return null;
  }
  if (booking.terms_status === 'signed') return 'T&Cs signed';
  if (booking.terms_status === 'pending') return 'T&Cs pending';
  return null;
}

export function buildBookingTermsAckUrl(businessId, token, siteUrl) {
  const base = String(siteUrl || '').replace(/\/$/, '');
  return `${base}/customer-portal/${businessId}/portal/booking-terms/${token}`;
}
