import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@17.4.0";
import { authorizeStripeModuleAdmin, getServiceClient } from "../_shared/stripeModuleBillingAuth.ts";

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

async function ensurePrice(
  stripe: Stripe,
  productId: string,
  existingPriceId: string | null | undefined,
  unitAmountCents: number,
  nickname: string,
  moduleKey: string,
  priceRole: "base" | "seat",
): Promise<string> {
  if (existingPriceId) {
    try {
      const p = await stripe.prices.retrieve(existingPriceId);
      const metaOk = p.metadata?.module_key === moduleKey && p.metadata?.price_role === priceRole;
      if (
        p.active === true &&
        p.unit_amount === unitAmountCents &&
        p.currency === "cad" &&
        p.recurring?.interval === "month" &&
        metaOk
      ) {
        return existingPriceId;
      }
      await stripe.prices.update(existingPriceId, { active: false });
    } catch {
      // stale id
    }
  }

  const created = await stripe.prices.create({
    currency: "cad",
    unit_amount: unitAmountCents,
    recurring: { interval: "month" },
    product: productId,
    nickname,
    tax_behavior: "exclusive",
    metadata: {
      module_key: moduleKey,
      price_role: priceRole,
    },
  });
  return created.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!(await authorizeStripeModuleAdmin(req))) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { module_key?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const moduleKey = (body.module_key || "").trim() || null;

  try {
    const stripe = getStripe();
    const admin = getServiceClient();

    let query = admin.from("app_modules").select(
      "module_key, module_name, billing_base_cents, billing_seat_cents, stripe_product_id, stripe_base_price_id, stripe_seat_price_id",
    );
    if (moduleKey) query = query.eq("module_key", moduleKey);
    const { data: modules, error } = await query;
    if (error) throw error;

    const results: { module_key: string; stripe_product_id: string; stripe_base_price_id: string; stripe_seat_price_id: string }[] = [];

    for (const m of modules || []) {
      const key = m.module_key as string;
      const name = (m.module_name as string) || key;
      let productId = m.stripe_product_id as string | null;
      if (!productId) {
        const prod = await stripe.products.create({
          name: `Tavari module: ${name}`,
          metadata: { module_key: key, app: "tavarios" },
        });
        productId = prod.id;
      } else {
        try {
          await stripe.products.retrieve(productId);
        } catch {
          const prod = await stripe.products.create({
            name: `Tavari module: ${name}`,
            metadata: { module_key: key, app: "tavarios" },
          });
          productId = prod.id;
        }
      }

      const baseCents = Math.max(0, Number(m.billing_base_cents) || 0);
      const seatCents = Math.max(0, Number(m.billing_seat_cents) || 0);

      const basePriceId = await ensurePrice(
        stripe,
        productId,
        m.stripe_base_price_id as string | null,
        baseCents,
        `${key}-base-monthly`,
        key,
        "base",
      );
      const seatPriceId = await ensurePrice(
        stripe,
        productId,
        m.stripe_seat_price_id as string | null,
        seatCents,
        `${key}-seat-monthly`,
        key,
        "seat",
      );

      const { error: upErr } = await admin.from("app_modules").update({
        stripe_product_id: productId,
        stripe_base_price_id: basePriceId,
        stripe_seat_price_id: seatPriceId,
      }).eq("module_key", key);
      if (upErr) throw upErr;

      results.push({
        module_key: key,
        stripe_product_id: productId,
        stripe_base_price_id: basePriceId,
        stripe_seat_price_id: seatPriceId,
      });
    }

    return json({ ok: true, synced: results.length, results });
  } catch (e) {
    console.error("[stripe-sync-module-prices]", e);
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
