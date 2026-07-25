import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { previewGiftCardForBookingCharge } from "../_shared/bookingGiftCards.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const businessId = String(body.businessId || body.business_id || "").trim();
    const code = String(body.code || body.giftCardCode || body.gift_card_code || "").trim();
    const chargeNow = Number(body.chargeNow ?? body.charge_now ?? body.amount ?? 0);

    if (!businessId) return jsonResponse({ error: "Missing businessId." }, 400);
    if (!code) return jsonResponse({ error: "Enter a gift card code." }, 400);
    if (!Number.isFinite(chargeNow) || chargeNow <= 0) {
      return jsonResponse({ error: "Invalid amount due." }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const preview = await previewGiftCardForBookingCharge(supabase, businessId, code, chargeNow);

    return jsonResponse({
      ok: true,
      giftCardId: preview.giftCardId,
      code: preview.code,
      balance: preview.balance,
      appliedAmount: preview.appliedAmount,
      remainingDue: preview.remainingDue,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not apply gift card";
    return jsonResponse({ error: message }, 400);
  }
});
