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

  let body: { business_id?: string; module_keys?: string[]; success_url?: string; cancel_url?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const businessId = (body.business_id || "").trim();
  const moduleKeys = Array.isArray(body.module_keys) ? body.module_keys.map((k) => String(k).trim()).filter(Boolean) : [];
  if (!businessId || moduleKeys.length === 0) {
    return json({ error: "business_id and module_keys[] required" }, 400);
  }

  if (!(await authorizeBusinessBillingWrite(req, businessId))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://www.tavarios.ca").replace(/\/$/, "");
  const successUrl = (body.success_url || `${siteUrl}/dashboard?stripe=success`).trim();
  const cancelUrl = (body.cancel_url || `${siteUrl}/dashboard?stripe=cancel`).trim();

  try {
    const stripe = getStripe();
    const admin = getServiceClient();

    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .select("id, name, business_email, stripe_customer_id, stripe_subscription_id")
      .eq("id", businessId)
      .maybeSingle();
    if (bizErr) throw bizErr;
    if (!biz) return json({ error: "Business not found" }, 404);

    if (biz.stripe_subscription_id) {
      return json({
        error: "Business already has a Stripe subscription. Add modules via dashboard or cancel first.",
        stripe_subscription_id: biz.stripe_subscription_id,
      }, 400);
    }

    let customerId = biz.stripe_customer_id as string | null;
    if (!customerId) {
      const cust = await stripe.customers.create({
        email: (biz.business_email as string) || undefined,
        name: (biz.name as string) || undefined,
        metadata: { business_id: businessId, app: "tavarios" },
      });
      customerId = cust.id;
      await admin.from("businesses").update({ stripe_customer_id: customerId }).eq("id", businessId);
    }

    const { data: accessRows } = await admin
      .from("business_module_user_access")
      .select("module_key")
      .eq("business_id", businessId);
    const accessCount = new Map<string, number>();
    for (const r of accessRows || []) {
      const k = r.module_key as string;
      accessCount.set(k, (accessCount.get(k) || 0) + 1);
    }

    const { data: modules, error: modErr } = await admin
      .from("app_modules")
      .select("module_key, billing_included_seats, stripe_base_price_id, stripe_seat_price_id")
      .in("module_key", moduleKeys);
    if (modErr) throw modErr;

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    for (const key of moduleKeys) {
      const m = (modules || []).find((x) => x.module_key === key);
      if (!m?.stripe_base_price_id || !m?.stripe_seat_price_id) {
        return json({
          error: `Module "${key}" missing Stripe price IDs. Run stripe-sync-module-prices first.`,
        }, 400);
      }
      const n = accessCount.get(key) || 0;
      const included = Number(m.billing_included_seats) || 0;
      const seatQty = billableSeats(n, included);
      lineItems.push({ price: m.stripe_base_price_id as string, quantity: 1 });
      lineItems.push({ price: m.stripe_seat_price_id as string, quantity: seatQty });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: lineItems,
      success_url: successUrl.includes("{CHECKOUT_SESSION_ID}")
        ? successUrl
        : `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      metadata: {
        business_id: businessId,
        module_keys: moduleKeys.join(","),
      },
      subscription_data: {
        metadata: {
          business_id: businessId,
          module_keys: moduleKeys.join(","),
        },
      },
    });

    return json({ url: session.url, id: session.id });
  } catch (e) {
    console.error("[stripe-create-module-subscription-checkout]", e);
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
