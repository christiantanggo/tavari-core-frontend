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

  let body: { business_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const businessId = (body.business_id || "").trim();
  if (!businessId) return json({ error: "business_id required" }, 400);

  if (!(await authorizeBusinessBillingWrite(req, businessId))) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const admin = getServiceClient();
    const stripe = getStripe();

    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .select("id, stripe_subscription_id")
      .eq("id", businessId)
      .maybeSingle();
    if (bizErr) throw bizErr;
    if (!biz?.stripe_subscription_id) {
      return json({ error: "No Stripe subscription on file for this business" }, 400);
    }

    const { data: items, error: itemsErr } = await admin
      .from("business_module_stripe_items")
      .select("module_key, stripe_subscription_item_base_id, stripe_subscription_item_seat_id")
      .eq("business_id", businessId);
    if (itemsErr) throw itemsErr;

    const { data: accessRows, error: accErr } = await admin
      .from("business_module_user_access")
      .select("module_key")
      .eq("business_id", businessId);
    if (accErr) throw accErr;

    const accessCount = new Map<string, number>();
    for (const r of accessRows || []) {
      const k = r.module_key as string;
      accessCount.set(k, (accessCount.get(k) || 0) + 1);
    }

    const { data: modRows, error: modErr } = await admin
      .from("app_modules")
      .select("module_key, billing_included_seats");
    if (modErr) throw modErr;
    const includedByKey = new Map<string, number>();
    for (const r of modRows || []) {
      includedByKey.set(r.module_key as string, Number(r.billing_included_seats) || 0);
    }

    const updates: { module_key: string; quantity: number; item_id: string }[] = [];

    for (const row of items || []) {
      const moduleKey = row.module_key as string;
      const seatItemId = row.stripe_subscription_item_seat_id as string | null;
      if (!seatItemId) continue;

      const n = accessCount.get(moduleKey) || 0;
      const included = includedByKey.get(moduleKey) ?? 0;
      const qty = billableSeats(n, included);

      await stripe.subscriptionItems.update(seatItemId, {
        quantity: qty,
        proration_behavior: "create_prorations",
      });
      updates.push({ module_key: moduleKey, quantity: qty, item_id: seatItemId });
    }

    return json({ ok: true, business_id: businessId, updates });
  } catch (e) {
    console.error("[stripe-update-subscription-seats]", e);
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
