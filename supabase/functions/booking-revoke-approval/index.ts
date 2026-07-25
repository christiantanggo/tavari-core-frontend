import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cancelBookingPaymentRequest } from "../_shared/bookingPaymentRequest.ts";
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
    const reason = String(body.reason || body.explanation || "").trim();

    if (!businessId || !bookingId) {
      return jsonResponse({ error: "Missing businessId or bookingId" }, 400);
    }
    if (!reason) {
      return jsonResponse({ error: "An explanation is required to remove approval." }, 400);
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
        status,
        payment_status,
        requires_approval,
        approved_at
      `)
      .eq("id", bookingId)
      .eq("business_id", businessId)
      .single();

    if (bookingError || !booking) {
      return jsonResponse({ error: "Booking not found" }, 404);
    }

    if (!booking.requires_approval) {
      return jsonResponse({ error: "This booking does not use the approval workflow." }, 400);
    }
    if (!booking.approved_at) {
      return jsonResponse({ error: "This booking is not approved." }, 409);
    }
    if (booking.status === "cancelled") {
      return jsonResponse({ error: "Cannot change approval on a cancelled booking." }, 400);
    }
    if (booking.status === "checked_in" || booking.status === "completed") {
      return jsonResponse({ error: "Cannot remove approval after check-in or completion." }, 400);
    }
    if (booking.payment_status === "partial" || booking.payment_status === "paid") {
      return jsonResponse({ error: "Cannot remove approval after a deposit or payment has been received." }, 400);
    }

    const now = new Date().toISOString();
    const clientIp = getRequestClientIp(req);

    await cancelBookingPaymentRequest(supabase, businessId, bookingId, user.id);

    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        approved_at: null,
        approved_by: null,
        status: "pending",
        deposit_due_at: null,
        updated_by: user.id,
        updated_ip: clientIp,
        updated_at: now,
      })
      .eq("id", bookingId)
      .eq("business_id", businessId);

    if (updateError) {
      console.error("[booking-revoke-approval] update failed:", updateError);
      return jsonResponse({ error: "Failed to remove approval" }, 500);
    }

    return jsonResponse({ ok: true, bookingId }, 200);
  } catch (err) {
    console.error("[booking-revoke-approval]", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Server error" }, 500);
  }
});
