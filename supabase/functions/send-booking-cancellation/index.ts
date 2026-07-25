import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendBookingCancellationEmail } from "../_shared/bookingCancellationEmail.ts";
import type { BookingCancellationSource } from "../_shared/bookingTransactionalEmail.ts";

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
    const cancelledByRaw = String(body.cancelledBy || body.cancelled_by || "staff").trim().toLowerCase();
    const cancelledBy = (["staff", "customer", "system"].includes(cancelledByRaw)
      ? cancelledByRaw
      : "staff") as BookingCancellationSource;
    const reason = typeof body.reason === "string" ? body.reason.trim() : null;
    const cancelledAt = String(body.cancelledAt || body.cancelled_at || "").trim() || null;

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

    const result = await sendBookingCancellationEmail(supabase, {
      businessId,
      bookingId,
      cancelledBy,
      reason,
      cancelledAt,
    });

    if (result.skipped) {
      return jsonResponse({ sent: false, skipped: true, reason: result.reason }, 200);
    }

    return jsonResponse({ sent: true }, 200);
  } catch (err) {
    console.error("[send-booking-cancellation]", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Server error" },
      500,
    );
  }
});
