/**
 * Inbound ChargeNow cabinet event push.
 * Optional query: ?business_id=<uuid> for chargenow_webhook_events.
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

    const body = await req.json().catch(() => ({}));
    console.log("[chargenow-cabinet-event]", JSON.stringify(body)?.slice(0, 8000));

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceKey) {
      const admin = createClient(supabaseUrl, serviceKey);
      const { error } = await admin.from("chargenow_webhook_events").insert({
        business_id: businessId,
        event_source: "cabinet_event",
        payload: body && typeof body === "object" ? body : { raw: body },
      });
      if (error) console.error("[chargenow-cabinet-event] db insert:", error.message);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[chargenow-cabinet-event]", e);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
