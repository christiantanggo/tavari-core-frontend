import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOOKING_TRANSACTIONAL_FROM_EMAIL } from "../_shared/bookingTransactionalMail.ts";
import { buildBookingManageUrl, getOrCreateBookingSelfServiceToken } from "../_shared/bookingSelfService.ts";
import {
  buildBookingCampGuideEmail,
  loadBookingEmailBusinessContext,
  resolveBookingRecipientName,
} from "../_shared/bookingTransactionalEmail.ts";
import {
  resolveBookingMailRecipients,
  withBookingMailRecipients,
} from "../_shared/bookingRecipientEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const DEFAULT_GUIDE_URL = "https://www.offthewallkids.ca/summer-camps-london-ontario";

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolveCampGuideUrl(ticketSettings: unknown, websiteCampProgram: string | null) {
  const settings = ticketSettings && typeof ticketSettings === "object"
    ? ticketSettings as Record<string, unknown>
    : {};
  const configured = typeof settings.camp_guide_url === "string" ? settings.camp_guide_url.trim() : "";
  if (configured) return configured;

  const program = String(websiteCampProgram || "").trim().toLowerCase();
  if (program === "pa_day") return "https://www.offthewallkids.ca/pa-day-activities-london-ontario";
  if (program.includes("march")) return "https://www.offthewallkids.ca/march-break-camps-london-ontario";
  if (program.includes("winter")) return "https://www.offthewallkids.ca/winter-break-camp-london-ontario";
  if (program.includes("summer")) return "https://www.offthewallkids.ca/summer-camps-london-ontario";
  return DEFAULT_GUIDE_URL;
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
    const forceResend = body.resend === true || body.force === true;

    if (!businessId || !bookingId) {
      return jsonResponse({ error: "Missing businessId or bookingId" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const campaignId = forceResend
      ? `${bookingId}-camp-guide-${Date.now()}`
      : `${bookingId}-camp-guide`;

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
      .select("id, booking_number, customer_email, secondary_customer_email, customer_id, booking_date, booking_time, activity_id, booking_type_id, status")
      .eq("id", bookingId)
      .eq("business_id", businessId)
      .single();

    if (bookingErr || !booking) {
      return jsonResponse({ error: "Booking not found" }, 404);
    }

    const [{ data: activity }, { data: bookingType }] = await Promise.all([
      supabase
        .from("booking_activities")
        .select("activity_name, ticket_settings, website_camp_program, type_id")
        .eq("id", booking.activity_id)
        .maybeSingle(),
      booking.booking_type_id
        ? supabase.from("booking_types").select("type_key").eq("id", booking.booking_type_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    let typeKey = typeof bookingType?.type_key === "string" ? bookingType.type_key : "";
    if (!typeKey && activity?.type_id) {
      const { data: typeFromActivity } = await supabase
        .from("booking_types")
        .select("type_key")
        .eq("id", activity.type_id)
        .maybeSingle();
      typeKey = typeof typeFromActivity?.type_key === "string" ? typeFromActivity.type_key : "";
    }

    const isDayCamp = typeKey === "day_camp" || Boolean(activity?.website_camp_program);
    if (!isDayCamp) {
      return jsonResponse({ sent: false, skipped: true, reason: "not_day_camp" }, 200);
    }

    const recipients = await resolveBookingMailRecipients(supabase, booking, businessId);
    if (!recipients) {
      return jsonResponse({ error: "No recipient email" }, 400);
    }

    const business = await loadBookingEmailBusinessContext(supabase, businessId);
    const recipientName = await resolveBookingRecipientName(supabase, booking, businessId);
    const manageToken = await getOrCreateBookingSelfServiceToken(supabase, bookingId, businessId);
    const manageUrl = buildBookingManageUrl(businessId, manageToken);
    const guideUrl = resolveCampGuideUrl(
      activity?.ticket_settings,
      typeof activity?.website_camp_program === "string" ? activity.website_camp_program : null,
    );

    const email = buildBookingCampGuideEmail({
      business,
      recipientName,
      bookingNumber: booking.booking_number || booking.id.slice(0, 8),
      activityName: activity?.activity_name || "Day Camp",
      bookingDate: String(booking.booking_date),
      bookingTime: String(booking.booking_time),
      manageUrl,
      guideUrl,
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
        fromName: `${business.name} - Camp`,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }, recipients)),
    });

    if (!mailResponse.ok) {
      const errText = await mailResponse.text();
      return jsonResponse({ error: "Failed to send email", detail: errText }, 502);
    }

    return jsonResponse({ sent: true, resent: forceResend, guideUrl }, 200);
  } catch (err) {
    console.error("[send-booking-camp-guide]", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Server error" }, 500);
  }
});
