import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  calculateOnlineCheckoutAmounts,
  parseOnlinePaymentFromTicketSettings,
} from "../_shared/bookingPaymentSettings.ts";
import { getRequestClientIp } from "../_shared/requestClientIp.ts";

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
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const businessId = String(body.businessId || body.business_id || "").trim();
    const bookingId = String(body.bookingId || body.booking_id || "").trim();

    if (!businessId || !bookingId) {
      return jsonResponse({ error: "Missing businessId or bookingId" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user?.id) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const { data: membership } = await supabase
      .from("business_users")
      .select("role")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id,
        business_id,
        activity_id,
        status,
        payment_status,
        requires_approval,
        approved_at,
        order_total,
        customer_id
      `)
      .eq("id", bookingId)
      .eq("business_id", businessId)
      .single();

    if (bookingError || !booking) {
      return jsonResponse({ error: "Booking not found" }, 404);
    }

    if (!booking.requires_approval) {
      return jsonResponse({ error: "This booking does not require approval." }, 400);
    }
    if (booking.approved_at) {
      return jsonResponse({ error: "Booking is already approved." }, 409);
    }
    if (booking.status === "cancelled") {
      return jsonResponse({ error: "Cannot approve a cancelled booking." }, 400);
    }

    const { data: termsBooking } = await supabase
      .from("bookings")
      .select("terms_package_id, terms_status, terms_signed_at")
      .eq("id", bookingId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (
      termsBooking?.terms_package_id
      && termsBooking.terms_status === "pending"
    ) {
      return jsonResponse({
        error: "Customer must sign the Terms & Conditions before this booking can be approved.",
      }, 400);
    }

    const { data: activity } = await supabase
      .from("booking_activities")
      .select("ticket_settings")
      .eq("id", booking.activity_id)
      .eq("business_id", businessId)
      .single();

    let ticketSettings: Record<string, unknown> = {};
    const raw = activity?.ticket_settings;
    if (typeof raw === "string") {
      try {
        ticketSettings = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        ticketSettings = {};
      }
    } else if (raw && typeof raw === "object") {
      ticketSettings = raw as Record<string, unknown>;
    }

    const onlinePayment = parseOnlinePaymentFromTicketSettings(ticketSettings);
    const orderTotal = Number(booking.order_total || 0);
    const checkout = calculateOnlineCheckoutAmounts(orderTotal, onlinePayment);
    const depositDueDays = onlinePayment.depositDueDaysAfterApproval;
    const depositDueAt = new Date(Date.now() + depositDueDays * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const clientIp = getRequestClientIp(req);

    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        approved_at: now,
        approved_by: user.id,
        status: "confirmed",
        deposit_due_at: depositDueAt,
        updated_by: user.id,
        updated_ip: clientIp,
        updated_at: now,
      })
      .eq("id", bookingId)
      .eq("business_id", businessId);

    if (updateError) {
      console.error("[booking-approve-request] update failed:", updateError);
      return jsonResponse({ error: "Failed to approve booking" }, 500);
    }

    try {
      await fetch(`${supabaseUrl}/functions/v1/send-booking-payment-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          businessId,
          bookingId,
          depositAmount: checkout.chargeNow,
          depositDueAt,
          sentBy: user.id,
          requestType: "deposit",
          resend: true,
        }),
      });
    } catch (mailErr) {
      console.warn("[booking-approve-request] payment request email failed:", mailErr);
    }

    return jsonResponse({
      ok: true,
      bookingId,
      depositDueAt,
      depositAmount: checkout.chargeNow,
    }, 200);
  } catch (err) {
    console.error("[booking-approve-request]", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Server error" }, 500);
  }
});
