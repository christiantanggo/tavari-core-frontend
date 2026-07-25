export function activityShowsTermsOnConfirmation(
  activityOrFlag: boolean | { terms_show_on_confirmation?: boolean | null } | null | undefined,
) {
  if (typeof activityOrFlag === "boolean") return activityOrFlag === true;
  return activityOrFlag?.terms_show_on_confirmation === true;
}

/** True when new bookings should attach pending Terms for post-booking acknowledgment. */
export function activityUsesPendingTermsOnBooking(activity: {
  terms_package_id?: string | null;
  terms_show_on_confirmation?: boolean | null;
} | null | undefined) {
  return Boolean(activity?.terms_package_id) && activityShowsTermsOnConfirmation(activity);
}

export function bookingRequiresTermsAcknowledgment(booking: {
  terms_package_id?: string | null;
  terms_status?: string | null;
} | null | undefined) {
  return Boolean(booking?.terms_package_id) && booking?.terms_status === "pending";
}

/**
 * Confirmation-page CTA: pending Terms only when the activity opted into
 * “show on booking confirmation”.
 */
export function bookingRequiresPartyTermsApprovalCta(
  booking: {
    terms_package_id?: string | null;
    terms_status?: string | null;
  } | null | undefined,
  activityOrShowFlag: boolean | { terms_show_on_confirmation?: boolean | null } | null | undefined,
) {
  return activityShowsTermsOnConfirmation(activityOrShowFlag)
    && bookingRequiresTermsAcknowledgment(booking);
}

export function bookingApprovalBlockedByTerms(booking: {
  terms_package_id?: string | null;
  terms_status?: string | null;
} | null | undefined) {
  return bookingRequiresTermsAcknowledgment(booking);
}

export function buildBookingTermsAckUrl(businessId: string, token: string, siteUrl: string) {
  const base = String(siteUrl || "").replace(/\/$/, "");
  return `${base}/customer-portal/${businessId}/portal/booking-terms/${token}`;
}

export async function ensureBookingTermsAckToken(
  supabase: { from: (table: string) => any },
  bookingId: string,
) {
  const { data: existing } = await supabase
    .from("bookings")
    .select("id, terms_ack_token, terms_package_id, terms_status")
    .eq("id", bookingId)
    .maybeSingle();

  if (!existing) return null;
  if (!existing.terms_package_id || existing.terms_status === "not_required") {
    return existing.terms_ack_token || null;
  }
  if (existing.terms_ack_token) return existing.terms_ack_token;

  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const { data: updated, error } = await supabase
    .from("bookings")
    .update({
      terms_ack_token: token,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .select("terms_ack_token")
    .single();

  if (error) throw error;
  return updated?.terms_ack_token || token;
}
