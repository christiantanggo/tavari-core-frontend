// Sends a test email showing how the thank-you block will look in booking confirmation emails.
// POST { businessId: string, to: string }
// Requires authenticated user with membership in business_users for businessId.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOOKING_TRANSACTIONAL_FROM_EMAIL } from "../_shared/bookingTransactionalMail.ts";
import {
  buildBookingConfirmationEmail,
  loadBookingEmailBusinessContext,
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as { businessId?: string; to?: string };
    const businessId = body?.businessId?.trim();
    const to = typeof body?.to === "string" ? body.to.trim().toLowerCase() : "";
    if (!businessId) {
      return jsonResponse({ error: "Missing businessId" }, 400);
    }
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return jsonResponse({ error: "Valid email address (to) is required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user?.id) {
      return jsonResponse({ error: "Invalid session" }, 401);
    }

    const { data: membership } = await supabaseUser
      .from("business_users")
      .select("user_id")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return jsonResponse({ error: "Access denied for this business" }, 403);
    }

    const businessCtx = await loadBookingEmailBusinessContext(supabase, businessId);

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
    const thankYouPlain = customThankYou || defaultThankYouPlain;

    const previewNote = thankYouEnabled
      ? `TEST PREVIEW — thank-you is ON. In live confirmation emails this yellow note appears under the booking details.\n\n${thankYouPlain}`
      : `TEST PREVIEW — thank-you is currently OFF. If you turn it on, customers would see:\n\n${thankYouPlain}`;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const sampleDate = tomorrow.toISOString().slice(0, 10);

    const email = buildBookingConfirmationEmail({
      business: businessCtx,
      recipientName: "Test Guest",
      bookingNumber: "TEST-0001",
      activityName: "Sample activity",
      bookingDate: sampleDate,
      bookingTime: "10:00:00",
      contactName: "Test Guest",
      contactEmail: to,
      ticketSummary: [{ name: "Sample ticket", qty: 2 }],
      guestCount: 2,
      orderTotal: 25,
      totalPaid: 25,
      balanceOwing: 0,
      manageUrl: `${Deno.env.get("SITE_URL") || "https://tavari.ca"}/customer-portal/${businessId}/portal`,
      thankYouMessage: previewNote,
    });

    const campaignId = `thank-you-test-${businessId}-${user.id}-${Date.now()}`;

    const mailPayload = {
      businessId,
      campaignId,
      contactId: user.id,
      emailType: "transactional",
      to,
      fromEmail: BOOKING_TRANSACTIONAL_FROM_EMAIL,
      fromName: `${businessCtx.name} - Booking (test)`,
      subject: `[Test] ${email.subject}`,
      html: email.html,
      text: email.text,
    };

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
      console.error("[test-booking-thank-you-email] mail-send error:", mailResponse.status, errText);
      return jsonResponse({ error: "Failed to send test email", detail: errText }, 502);
    }
    const mailData = await mailResponse.json();
    if (!mailData?.ok) {
      return jsonResponse({ error: mailData?.error || "Mail send failed" }, 502);
    }

    return jsonResponse({ ok: true, messageId: mailData.messageId }, 200);
  } catch (err) {
    console.error("[test-booking-thank-you-email]", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Server error" },
      500,
    );
  }
});
