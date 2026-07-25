import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOOKING_TRANSACTIONAL_FROM_EMAIL } from "./bookingTransactionalMail.ts";
import { buildBookingManageUrl, getOrCreateBookingSelfServiceToken } from "./bookingSelfService.ts";
import {
  resolveBookingMailRecipients,
  withBookingMailRecipients,
} from "./bookingRecipientEmail.ts";
import {
  buildBookingCancellationEmail,
  loadBookingEmailBusinessContext,
  resolveBookingRecipientName,
  type BookingCancellationSource,
} from "./bookingTransactionalEmail.ts";

export async function sendBookingCancellationEmail(
  supabase: SupabaseClient,
  params: {
    businessId: string;
    bookingId: string;
    cancelledBy: BookingCancellationSource;
    reason?: string | null;
    cancelledAt?: string | null;
  },
): Promise<{ sent: boolean; skipped?: boolean; reason?: string }> {
  const { businessId, bookingId, cancelledBy } = params;

  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select(`
      id,
      booking_number,
      customer_email,
      secondary_customer_email,
      customer_id,
      booking_date,
      booking_time,
      activity_id,
      status,
      cancellation_reason,
      cancelled_at
    `)
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .single();

  if (bookingErr || !booking) {
    throw new Error("Booking not found");
  }

  if (booking.status !== "cancelled") {
    throw new Error("Booking is not cancelled");
  }

  const recipients = await resolveBookingMailRecipients(supabase, booking, businessId);
  if (!recipients) {
    return { sent: false, skipped: true, reason: "no_recipient_email" };
  }

  const cancelledAt = String(params.cancelledAt || booking.cancelled_at || "").trim();
  if (!cancelledAt) {
    throw new Error("Missing cancellation timestamp");
  }

  const campaignId = `${bookingId}-cancelled-${cancelledAt}`;
  const { data: existingSend } = await supabase
    .from("mail_campaign_sends")
    .select("id")
    .eq("campaign_id", campaignId)
    .maybeSingle();

  if (existingSend?.id) {
    return { sent: false, skipped: true, reason: "already_sent" };
  }

  const [{ data: activity }] = await Promise.all([
    supabase.from("booking_activities").select("activity_name").eq("id", booking.activity_id).single(),
  ]);

  const business = await loadBookingEmailBusinessContext(supabase, businessId);
  const recipientName = await resolveBookingRecipientName(supabase, booking, businessId);
  const manageToken = await getOrCreateBookingSelfServiceToken(supabase, bookingId, businessId);
  const manageUrl = buildBookingManageUrl(businessId, manageToken);

  const reason = params.reason?.trim()
    || booking.cancellation_reason?.trim()
    || null;

  const email = buildBookingCancellationEmail({
    business,
    recipientName,
    bookingNumber: booking.booking_number || booking.id.slice(0, 8),
    activityName: activity?.activity_name || "Activity",
    bookingDate: String(booking.booking_date),
    bookingTime: String(booking.booking_time),
    cancelledBy,
    reason,
    manageUrl,
  });

  const mailResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(withBookingMailRecipients({
      businessId,
      campaignId,
      contactId: booking.customer_id || bookingId,
      emailType: "transactional",
      fromEmail: BOOKING_TRANSACTIONAL_FROM_EMAIL,
      fromName: `${business.name} - Bookings`,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }, recipients)),
  });

  if (!mailResponse.ok) {
    const errText = await mailResponse.text();
    throw new Error(`Failed to send cancellation email: ${errText}`);
  }

  return { sent: true };
}
