import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrCreateBookingSelfServiceToken } from "../_shared/bookingSelfService.ts";

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

    if (!businessId || !bookingId) {
      return jsonResponse({ error: "Missing businessId or bookingId" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("id, business_id, status")
      .eq("id", bookingId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (bookingErr || !booking) {
      return jsonResponse({ error: "Booking not found" }, 404);
    }

    const token = await getOrCreateBookingSelfServiceToken(supabase, bookingId, businessId);
    return jsonResponse({ token }, 200);
  } catch (err) {
    console.error("[ensure-booking-manage-token]", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Server error" },
      500,
    );
  }
});
