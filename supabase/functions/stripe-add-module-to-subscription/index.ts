import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@17.4.0";
import { authorizeBusinessBillingWrite, getServiceClient } from "../_shared/stripeModuleBillingAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function getStripe(): Stripe {
  const key = (Deno.env.get("STRIPE_SECRET_KEY") || Deno.env.get("STRIPE_SECRET_KEY_LIVE") || "").trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key, { apiVersion: "2024-11-20.acacia" });
}

function billableSeats(accessCount: number, includedSeats: number): number {
  if (includedSeats === -1) return 0;
  return Math.max(0, accessCount - includedSeats);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { business_id?: string; module_key?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const businessId = (body.business_id || "").trim();
  const moduleKey = (body.module_key || "").trim();
  if (!businessId || !moduleKey) return json({ error: "business_id and module_key required" }, 400);

  if (!(await authorizeBusinessBillingWrite(req, businessId))) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const stripe = getStripe();
    const admin = getServiceClient();

    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .select("id, stripe_subscription_id")
      .eq("id", businessId)
      .maybeSingle();
    if (bizErr) throw bizErr;
    if (!biz?.stripe_subscription_id) {
      return json({ error: "No Stripe subscription on file. Use checkout first." }, 400);
    }

    const { data: existing } = await admin
      .from("business_module_stripe_items")
      .select("module_key")
      .eq("business_id", businessId)
      .eq("module_key", moduleKey)
      .maybeSingle();
    if (existing?.module_key) {
      return json({ error: "Module already on subscription" }, 400);
    }

    const { data: mod, error: modErr } = await admin
      .from("app_modules")
      .select("module_key, billing_included_seats, stripe_base_price_id, stripe_seat_price_id")
      .eq("module_key", moduleKey)
      .maybeSingle();
    if (modErr) throw modErr;
    if (!mod?.stripe_base_price_id || !mod?.stripe_seat_price_id) {
      return json({ error: "Module missing Stripe price IDs. Sync prices in TOSA first." }, 400);
    }

    const { count } = await admin
      .from("business_module_user_access")
      .select("user_id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("module_key", moduleKey);
    const accessCount = count || 0;
    const included = Number(mod.billing_included_seats) || 0;
    const seatQty = billableSeats(accessCount, included);

    const baseItem = await stripe.subscriptionItems.create({
      subscription: biz.stripe_subscription_id as string,
      price: mod.stripe_base_price_id as string,
      quantity: 1,
      proration_behavior: "create_prorations",
    });
    const seatItem = await stripe.subscriptionItems.create({
      subscription: biz.stripe_subscription_id as string,
      price: mod.stripe_seat_price_id as string,
      quantity: seatQty,
      proration_behavior: "create_prorations",
    });

    await admin.from("business_module_stripe_items").upsert({
      business_id: businessId,
      module_key: moduleKey,
      stripe_subscription_item_base_id: baseItem.id,
      stripe_subscription_item_seat_id: seatItem.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "business_id,module_key" });

    return json({
      ok: true,
      module_key: moduleKey,
      base_item_id: baseItem.id,
      seat_item_id: seatItem.id,
      seat_quantity: seatQty,
    });
  } catch (e) {
    console.error("[stripe-add-module-to-subscription]", e);
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
