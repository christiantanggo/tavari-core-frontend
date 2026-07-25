// Complete a portal booking when a gift card covers the full chargeNow (no Helcim session).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { finalizePendingBooking } from "../_shared/bookingFinalization.ts";

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
    const pendingId = String(body.pendingId || body.pending_id || "").trim();
    if (!pendingId) return jsonResponse({ error: "Missing pendingId." }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: pending, error } = await supabase
      .from("booking_pending_helcim")
      .select("id, status, amount, gift_card_amount, gift_card_code, gift_card_id, booking_id")
      .eq("id", pendingId)
      .maybeSingle();

    if (error) return jsonResponse({ error: "Could not load checkout session." }, 500);
    if (!pending) return jsonResponse({ error: "Checkout session not found." }, 404);

    if (pending.status === "completed" && pending.booking_id) {
      const result = await finalizePendingBooking({
        supabase,
        pendingId,
        amount: 0,
        transactionId: null,
      });
      if (!result.ok) {
        return jsonResponse({ error: result.message || "Could not complete booking." }, result.status || 400);
      }
      return jsonResponse({
        ok: true,
        bookingId: result.bookingId,
        manageToken: result.manageToken || null,
        alreadyCompleted: true,
      });
    }

    const giftAmount = Math.round((Number(pending.gift_card_amount) || 0) * 100) / 100;
    const helcimAmount = Math.round((Number(pending.amount) || 0) * 100) / 100;
    if (giftAmount <= 0.009) {
      return jsonResponse({ error: "This checkout is not a gift-card-only payment." }, 400);
    }
    if (helcimAmount > 0.01) {
      return jsonResponse({
        error: "Card payment is still required for the remaining balance.",
      }, 400);
    }
    if (!pending.gift_card_code && !pending.gift_card_id) {
      return jsonResponse({ error: "Missing gift card on this checkout session." }, 400);
    }

    const result = await finalizePendingBooking({
      supabase,
      pendingId,
      amount: 0,
      transactionId: null,
    });

    if (!result.ok) {
      return jsonResponse({ error: result.message || "Could not complete booking." }, result.status || 400);
    }

    return jsonResponse({
      ok: true,
      bookingId: result.bookingId,
      manageToken: result.manageToken || null,
    });
  } catch (err) {
    console.error("[booking-complete-gift-card]", err);
    return jsonResponse({
      error: err instanceof Error ? err.message : "Server error",
    }, 500);
  }
});
