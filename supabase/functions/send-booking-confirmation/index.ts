// send-booking-confirmation: Sends a booking confirmation email in the shared
// party/booking transactional style (teal card template).
// Called from bookingFinalization after portal payment. Idempotent via booking_notifications claim.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOOKING_TRANSACTIONAL_FROM_EMAIL } from "../_shared/bookingTransactionalMail.ts";
import { buildBookingManageUrl, getOrCreateBookingSelfServiceToken } from "../_shared/bookingSelfService.ts";
import {
  resolveBookingMailRecipients,
  withBookingMailRecipients,
} from "../_shared/bookingRecipientEmail.ts";
import {
  buildBookingConfirmationEmail,
  loadBookingEmailBusinessContext,
  resolveBookingRecipientName,
} from "../_shared/bookingTransactionalEmail.ts";

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
    const body = (await req.json().catch(() => ({}))) as any;
    const businessId = body?.businessId ?? body?.business_id;
    const bookingId = body?.bookingId ?? body?.booking_id;
    if (!businessId || !bookingId) {
      return jsonResponse({ error: "Missing businessId or bookingId" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const campaignId = bookingId;

    // Atomic claim: only one caller may send confirmation for this booking.
    const { data: claimRow, error: claimError } = await supabase
      .from("booking_notifications")
      .insert({
        booking_id: bookingId,
        notification_type: "confirmation",
        delivery_method: ["email"],
        scheduled_for: new Date().toISOString(),
        status: "scheduled",
      })
      .select("id")
      .maybeSingle();

    if (claimError) {
      const duplicate =
        claimError.code === "23505" ||
        String(claimError.message || "").toLowerCase().includes("duplicate");
      if (duplicate) {
        return jsonResponse({ sent: false, skipped: true, reason: "already_sent" }, 200);
      }
      console.error("[send-booking-confirmation] Failed to claim confirmation send:", claimError);
      return jsonResponse({ error: "Could not claim confirmation send" }, 500);
    }

    if (!claimRow?.id) {
      return jsonResponse({ sent: false, skipped: true, reason: "already_sent" }, 200);
    }

    const markClaimFailed = async (message: string) => {
      await supabase
        .from("booking_notifications")
        .update({
          status: "failed",
          error_message: message,
        })
        .eq("id", claimRow.id);
    };

    // Backward compatibility: bookings confirmed before notification claim existed.
    const { data: legacySend } = await supabase
      .from("mail_campaign_sends")
      .select("id")
      .eq("campaign_id", campaignId)
      .limit(1)
      .maybeSingle();
    if (legacySend) {
      await supabase
        .from("booking_notifications")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          error_message: "Skipped — confirmation already sent (legacy log)",
        })
        .eq("id", claimRow.id);
      return jsonResponse({ sent: false, skipped: true, reason: "already_sent" }, 200);
    }

    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("id, booking_number, customer_id, customer_email, secondary_customer_email, customer_phone, business_id, activity_id, booking_date, booking_time, status, order_total")
      .eq("id", bookingId)
      .eq("business_id", businessId)
      .single();
    if (bookingErr || !booking) {
      if (claimRow?.id) {
        await markClaimFailed("Booking not found");
      }
      return jsonResponse({ error: "Booking not found" }, 404);
    }

    const recipients = await resolveBookingMailRecipients(supabase, booking, businessId);
    if (!recipients) {
      await markClaimFailed("No recipient email for this booking");
      return jsonResponse({ error: "No recipient email for this booking" }, 400);
    }

    const [businessCtx, activityRes, participantsRes, paymentsRes, recipientName] = await Promise.all([
      loadBookingEmailBusinessContext(supabase, businessId),
      supabase.from("booking_activities").select("id, activity_name").eq("id", booking.activity_id).single(),
      supabase.from("booking_participants").select("id, participant_id, inventory_item_id").eq("booking_id", bookingId).order("created_at"),
      supabase.from("booking_payments").select("id, amount_paid, payment_type, status").eq("booking_id", bookingId),
      resolveBookingRecipientName(supabase, booking, businessId),
    ]);
    const activity = activityRes.data as any;
    const participants = (participantsRes.data || []) as any[];
    const payments = (paymentsRes.data || []) as any[];

    const invIds = [...new Set(participants.map((p) => p.inventory_item_id).filter(Boolean))];
    let inventoryMap: Record<string, string> = {};
    if (invIds.length > 0) {
      const { data: inv } = await supabase.from("pos_inventory").select("id, name").in("id", invIds);
      (inv || []).forEach((i: any) => { inventoryMap[i.id] = i.name || "Ticket"; });
    }
    const byItem: Record<string, { name: string; qty: number }> = {};
    participants.forEach((p) => {
      const key = p.inventory_item_id || "other";
      if (!byItem[key]) byItem[key] = { name: inventoryMap[p.inventory_item_id] || "Participant", qty: 0 };
      byItem[key].qty += 1;
    });
    const ticketSummary = Object.values(byItem);

    let participant1Detail: { first_name?: string; last_name?: string; email?: string; phone_number?: string } | null = null;
    if (participants[0]?.participant_id) {
      const { data: p1 } = await supabase
        .from("booking_customer_participants")
        .select("first_name, last_name, email, phone_number")
        .eq("id", participants[0].participant_id)
        .eq("business_id", businessId)
        .maybeSingle();
      participant1Detail = p1 as any;
    }

    const totalPaid = payments
      .filter((p) => p.status === "completed")
      .reduce((s, p) => s + Number(p.amount_paid || 0), 0);
    const orderTotal = Number(booking.order_total || 0) > 0
      ? Number(booking.order_total)
      : totalPaid;
    const balanceOwing = Math.max(0, orderTotal - totalPaid);
    const manageToken = await getOrCreateBookingSelfServiceToken(supabase, bookingId, businessId);
    const manageUrl = buildBookingManageUrl(businessId, manageToken);

    const contactName = participant1Detail
      ? [participant1Detail.first_name, participant1Detail.last_name].filter(Boolean).join(" ") || null
      : recipientName;
    const contactEmail = participant1Detail?.email || booking.customer_email || null;
    const contactPhone = participant1Detail?.phone_number || booking.customer_phone || null;
    const bookingNumber = booking.booking_number || String(booking.id).slice(0, 8);
    const activityName = activity?.activity_name || "Activity";

    const { data: thankYouSettingsRows } = await supabase
      .from("booking_settings")
      .select("setting_key, setting_value")
      .eq("business_id", businessId)
      .is("activity_id", null)
      .eq("is_global", true)
      .in("setting_key", ["thankYouEmailEnabled", "thankYouEmailMessage"]);

    const thankMap: Record<string, unknown> = {};
    (thankYouSettingsRows || []).forEach((r: { setting_key: string; setting_value: unknown }) => {
      thankMap[r.setting_key] = r.setting_value;
    });
    const thankYouEnabled = thankMap.thankYouEmailEnabled !== false;
    const rawThankYouMsg = thankMap.thankYouEmailMessage;
    const customThankYou =
      typeof rawThankYouMsg === "string" && rawThankYouMsg.trim().length > 0 ? rawThankYouMsg.trim() : "";
    const defaultThankYouPlain = "Thank you for booking with us — we look forward to seeing you!";
    const thankYouMessage = thankYouEnabled ? (customThankYou || defaultThankYouPlain) : null;

    const email = buildBookingConfirmationEmail({
      business: businessCtx,
      recipientName: recipientName || contactName,
      bookingNumber,
      activityName,
      bookingDate: String(booking.booking_date || ""),
      bookingTime: String(booking.booking_time || ""),
      contactName,
      contactEmail,
      contactPhone,
      ticketSummary,
      guestCount: participants.length || null,
      orderTotal,
      totalPaid,
      balanceOwing,
      manageUrl,
      thankYouMessage,
    });

    const mailPayload = withBookingMailRecipients({
      businessId,
      campaignId,
      contactId: booking.customer_id || bookingId,
      emailType: "transactional",
      fromEmail: BOOKING_TRANSACTIONAL_FROM_EMAIL,
      fromName: `${businessCtx.name} - Booking`,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }, recipients);

    const mailResponse = await fetch(`${supabaseUrl}/functions/v1/mail-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify(mailPayload),
    });

    if (!mailResponse.ok) {
      const errText = await mailResponse.text();
      console.error("[send-booking-confirmation] mail-send HTTP error:", mailResponse.status, errText);
      await markClaimFailed(errText || "Mail send HTTP error");
      return jsonResponse({ error: "Failed to send email", detail: errText }, 502);
    }
    const mailData = await mailResponse.json();
    if (!mailData?.ok) {
      console.error("[send-booking-confirmation] mail-send returned error:", mailData?.error);
      await markClaimFailed(String(mailData?.error || "Mail send failed"));
      return jsonResponse({ error: mailData?.error || "Mail send failed" }, 502);
    }

    await supabase
      .from("booking_notifications")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        message_id: mailData.messageId ? String(mailData.messageId) : null,
        error_message: null,
      })
      .eq("id", claimRow.id);

    return jsonResponse({ sent: true, messageId: mailData.messageId }, 200);
  } catch (err) {
    console.error("[send-booking-confirmation]", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Server error" },
      500
    );
  }
});
