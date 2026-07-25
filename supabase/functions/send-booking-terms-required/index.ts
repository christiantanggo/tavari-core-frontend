import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOOKING_TRANSACTIONAL_FROM_EMAIL } from "../_shared/bookingTransactionalMail.ts";
import { buildBookingManageUrl, getOrCreateBookingSelfServiceToken } from "../_shared/bookingSelfService.ts";
import {
  buildBookingTermsRequiredEmail,
  loadBookingEmailBusinessContext,
  resolveBookingRecipientName,
} from "../_shared/bookingTransactionalEmail.ts";
import {
  resolveBookingMailRecipients,
  withBookingMailRecipients,
} from "../_shared/bookingRecipientEmail.ts";
import {
  bookingRequiresTermsAcknowledgment,
  buildBookingTermsAckUrl,
  ensureBookingTermsAckToken,
} from "../_shared/bookingTermsAcknowledgment.ts";
import { resolvePublicSiteUrl } from "../_shared/invoicePublicSiteUrl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const businessId = String(body.businessId || body.business_id || "").trim();
    const bookingId = String(body.bookingId || body.booking_id || "").trim();
    const manageToken = typeof body.manageToken === "string" ? body.manageToken.trim() : "";
    const forceResend = body.resend === true || body.force === true;

    if (!businessId || !bookingId) {
      return jsonResponse({ error: "Missing businessId or bookingId" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const campaignId = forceResend
      ? `${bookingId}-terms-required-${Date.now()}`
      : `${bookingId}-terms-required`;

    if (!forceResend) {
      const { data: existing } = await supabase
        .from("mail_campaign_sends")
        .select("id")
        .eq("campaign_id", campaignId)
        .limit(1)
        .maybeSingle();
      if (existing) {
        return jsonResponse({ sent: false, skipped: true, reason: "already_sent" }, 200);
      }
    }

    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("id, booking_number, customer_email, secondary_customer_email, customer_id, booking_date, booking_time, activity_id, terms_package_id, terms_status, terms_ack_token")
      .eq("id", bookingId)
      .eq("business_id", businessId)
      .single();

    if (bookingErr || !booking) {
      return jsonResponse({ error: "Booking not found" }, 404);
    }

    if (!booking.terms_package_id) {
      return jsonResponse({ error: "This booking does not require Terms & Conditions." }, 400);
    }

    if (booking.terms_status === "signed") {
      return jsonResponse({ sent: false, skipped: true, reason: "already_signed" }, 200);
    }

    if (!bookingRequiresTermsAcknowledgment(booking) && booking.terms_status !== "pending") {
      return jsonResponse({ error: "Terms & Conditions are not pending for this booking." }, 400);
    }

    const recipients = await resolveBookingMailRecipients(supabase, booking, businessId);
    if (!recipients) {
      return jsonResponse({ error: "No recipient email" }, 400);
    }

    const termsToken = await ensureBookingTermsAckToken(supabase, bookingId);
    if (!termsToken) {
      return jsonResponse({ error: "Could not create Terms & Conditions link." }, 500);
    }

    const siteUrl = resolvePublicSiteUrl(
      Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("VITE_PUBLIC_SITE_URL") || Deno.env.get("VITE_APP_URL"),
    );
    const termsUrl = buildBookingTermsAckUrl(businessId, termsToken, siteUrl);

    const [{ data: activity }, { count: participantCount }] = await Promise.all([
      supabase.from("booking_activities").select("activity_name").eq("id", booking.activity_id).single(),
      supabase
        .from("booking_participants")
        .select("id", { count: "exact", head: true })
        .eq("booking_id", bookingId),
    ]);

    const business = await loadBookingEmailBusinessContext(supabase, businessId);
    const recipientName = await resolveBookingRecipientName(supabase, booking, businessId);
    const resolvedManageToken = manageToken || await getOrCreateBookingSelfServiceToken(supabase, bookingId, businessId);
    const manageUrl = buildBookingManageUrl(businessId, resolvedManageToken);

    const email = buildBookingTermsRequiredEmail({
      business,
      recipientName,
      bookingNumber: booking.booking_number || booking.id.slice(0, 8),
      activityName: activity?.activity_name || "Activity",
      bookingDate: String(booking.booking_date),
      bookingTime: String(booking.booking_time),
      participantCount: participantCount || 1,
      manageUrl,
      termsUrl,
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
      return jsonResponse({ error: "Failed to send email", detail: errText }, 502);
    }

    return jsonResponse({ sent: true, resent: forceResend }, 200);
  } catch (err) {
    console.error("[send-booking-terms-required]", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Server error" }, 500);
  }
});
