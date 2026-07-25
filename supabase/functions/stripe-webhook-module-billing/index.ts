import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@17.4.0";
import { getServiceClient } from "../_shared/stripeModuleBillingAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function getStripe(): Stripe {
  const key = (Deno.env.get("STRIPE_SECRET_KEY") || Deno.env.get("STRIPE_SECRET_KEY_LIVE") || "").trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key, { apiVersion: "2024-11-20.acacia" });
}

async function persistSubscriptionItems(
  stripe: Stripe,
  admin: ReturnType<typeof getServiceClient>,
  subscriptionId: string,
  businessId: string,
) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  });

  const byModule = new Map<string, { base?: string; seat?: string }>();
  for (const it of sub.items.data) {
    const price = it.price as Stripe.Price;
    const mk = (price.metadata?.module_key || "").trim();
    const role = (price.metadata?.price_role || "").trim();
    if (!mk) continue;
    const cur = byModule.get(mk) || {};
    if (role === "base") cur.base = it.id;
    if (role === "seat") cur.seat = it.id;
    byModule.set(mk, cur);
  }

  for (const [moduleKey, ids] of byModule) {
    if (!ids.base && !ids.seat) continue;
    await admin.from("business_module_stripe_items").upsert(
      {
        business_id: businessId,
        module_key: moduleKey,
        stripe_subscription_item_base_id: ids.base || null,
        stripe_subscription_item_seat_id: ids.seat || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,module_key" },
    );
  }

  await admin.from("businesses").update({
    stripe_subscription_id: sub.id,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null,
  }).eq("id", businessId);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const webhookSecret = (Deno.env.get("STRIPE_WEBHOOK_SECRET") || "").trim();
  if (!webhookSecret) {
    return new Response("Webhook secret not configured", { status: 400, headers: corsHeaders });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing stripe-signature", { status: 400, headers: corsHeaders });

  const payload = await req.text();
  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
  } catch (e) {
    console.error("[stripe-webhook-module-billing] verify", e);
    return new Response(`Webhook signature verification failed: ${(e as Error).message}`, {
      status: 400,
      headers: corsHeaders,
    });
  }

  const admin = getServiceClient();
  const stripe = getStripe();

  try {
    switch (event.type) {
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;
        const businessId = (sub.metadata?.business_id || "").trim();
        if (businessId && sub.id) {
          await persistSubscriptionItems(stripe, admin, sub.id, businessId);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const businessId = (sub.metadata?.business_id || "").trim();
        if (businessId) {
          await admin.from("businesses").update({
            stripe_subscription_id: null,
          }).eq("id", businessId);
          await admin.from("business_module_stripe_items").delete().eq("business_id", businessId);
        }
        break;
      }
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const businessId = (session.metadata?.business_id || "").trim();
        const subId = typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
        const customerId = typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;
        if (businessId && customerId) {
          await admin.from("businesses").update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subId || null,
          }).eq("id", businessId);
        }
        if (businessId && subId) {
          await persistSubscriptionItems(stripe, admin, subId, businessId);
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("[stripe-webhook-module-billing] handler", e);
    return json({ error: (e as Error).message }, 500);
  }

  return json({ received: true });
});
