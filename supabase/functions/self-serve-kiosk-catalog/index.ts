// Public catalog for self-serve ordering kiosk (anon invoke — filter server-side by business_id).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const businessId = String(body.businessId ?? body.business_id ?? "").trim();

    if (!businessId || !UUID_RE.test(businessId)) {
      return new Response(JSON.stringify({ error: "Valid businessId is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      return new Response(JSON.stringify({ error: "Server configuration error." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(url, key);

    const { data: biz, error: bizErr } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", businessId)
      .maybeSingle();

    if (bizErr || !biz) {
      return new Response(JSON.stringify({ error: "Business not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: categories, error: catErr }, { data: products, error: prodErr }] = await Promise.all([
      supabase
        .from("pos_categories")
        .select("id, name, color, emoji, sort_order")
        .eq("business_id", businessId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("pos_inventory")
        .select(
          "id, name, price, sku, category_id, category_sort_order, track_stock, stock_quantity, image_url, modifier_group_ids",
        )
        .eq("business_id", businessId)
        .or("is_active.eq.true,is_active.is.null")
        .order("name", { ascending: true }),
    ]);

    if (catErr) {
      console.error("[self-serve-kiosk-catalog] categories", catErr);
      return new Response(JSON.stringify({ error: "Could not load categories." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (prodErr) {
      console.error("[self-serve-kiosk-catalog] products", prodErr);
      return new Response(JSON.stringify({ error: "Could not load products." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        categories: categories ?? [],
        products: products ?? [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[self-serve-kiosk-catalog]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
