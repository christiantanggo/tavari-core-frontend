import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOOKING_TRANSACTIONAL_FROM_EMAIL } from "../_shared/bookingTransactionalMail.ts";
import { buildBookingManageUrl, getOrCreateBookingSelfServiceToken } from "../_shared/bookingSelfService.ts";
import {
  buildBookingRequestReceivedEmail,
  loadBookingEmailBusinessContext,
  resolveBookingRecipientName,
} from "../_shared/bookingTransactionalEmail.ts";
import {
  resolveBookingMailRecipients,
  withBookingMailRecipients,
} from "../_shared/bookingRecipientEmail.ts";
import { bookingRequiresTermsAcknowledgment } from "../_shared/bookingTermsAcknowledgment.ts";

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
    const alsoSendTerms = body.sendTerms !== false && body.send_terms !== false;

    if (!businessId || !bookingId) {
      return jsonResponse({ error: "Missing businessId or bookingId" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const campaignId = forceResend
      ? `${bookingId}-request-received-${Date.now()}`
      : `${bookingId}-request-received`;

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
      .select("id, booking_number, customer_email, secondary_customer_email, customer_id, booking_date, booking_time, activity_id, order_total, terms_package_id, terms_status, terms_ack_token")
      .eq("id", bookingId)
      .eq("business_id", businessId)
      .single();

    if (bookingErr || !booking) {
      return jsonResponse({ error: "Booking not found" }, 404);
    }

    const recipients = await resolveBookingMailRecipients(supabase, booking, businessId);
    if (!recipients) {
      return jsonResponse({ error: "No recipient email" }, 400);
    }

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
    const termsRequired = bookingRequiresTermsAcknowledgment(booking);

    const email = buildBookingRequestReceivedEmail({
      business,
      recipientName,
      bookingNumber: booking.booking_number || booking.id.slice(0, 8),
      activityName: activity?.activity_name || "Activity",
      bookingDate: String(booking.booking_date),
      bookingTime: String(booking.booking_time),
      participantCount: participantCount || 1,
      orderTotal: Number(booking.order_total) > 0 ? Number(booking.order_total) : null,
      manageUrl,
      termsRequired,
    });

    const mailResponse = await fetch(`${supabaseUrl}/functions/v1/mail-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
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

    let termsEmail: { sent?: boolean; skipped?: boolean; reason?: string; error?: string } | null = null;
    if (alsoSendTerms && termsRequired) {
      try {
        const termsResponse = await fetch(`${supabaseUrl}/functions/v1/send-booking-terms-required`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            businessId,
            bookingId,
            manageToken: resolvedManageToken,
            // First-time path should send even if somehow already attempted; resend of request-received shouldn't force terms.
            resend: forceResend,
          }),
        });
        const termsBody = await termsResponse.json().catch(() => ({}));
        if (!termsResponse.ok) {
          termsEmail = { error: String((termsBody as { error?: string })?.error || "Failed to send terms email") };
          console.warn("[send-booking-request-received] terms email failed:", termsBody);
        } else {
          termsEmail = termsBody as { sent?: boolean; skipped?: boolean; reason?: string };
        }
      } catch (termsErr) {
        console.warn("[send-booking-request-received] terms email invoke failed:", termsErr);
        termsEmail = { error: termsErr instanceof Error ? termsErr.message : "Terms email failed" };
      }
    }

    return jsonResponse({
      sent: true,
      resent: forceResend,
      termsEmail,
    }, 200);
  } catch (err) {
    console.error("[send-booking-request-received]", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Server error" }, 500);
  }
});
