/**
 * ChargeNow rent flow callback (/rent/order/create callbackURL).
 * Optional query: ?business_id=<uuid> to attribute rows in chargenow_webhook_events.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const businessId = url.searchParams.get("business_id")?.trim() || null;

    const ct = req.headers.get("content-type") || "";
    const text = await req.text();
    let payload: Record<string, unknown> = {};

    if (ct.includes("application/json")) {
      try {
        const j = JSON.parse(text);
        if (j && typeof j === "object") payload = j as Record<string, unknown>;
      } catch {
        console.log("[chargenow-rent-callback] non-json body:", text?.slice(0, 500));
      }
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const usp = new URLSearchParams(text);
      usp.forEach((v, k) => {
        payload[k] = v;
      });
    } else {
      console.log("[chargenow-rent-callback] raw:", text?.slice(0, 2000));
    }

    console.log("[chargenow-rent-callback]", JSON.stringify(payload));

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceKey) {
      const admin = createClient(supabaseUrl, serviceKey);
      const { error } = await admin.from("chargenow_webhook_events").insert({
        business_id: businessId,
        event_source: "rent_callback",
        payload,
      });
      if (error) console.error("[chargenow-rent-callback] db insert:", error.message);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[chargenow-rent-callback]", e);
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
