// Deprecated alias — use tavari-api-business-products?context=admission instead.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildProductPriceFields,
  INVENTORY_WEBSITE_SELECT_COLS,
  type InventoryRow,
  isProductAvailable,
  trimText,
} from "../_shared/tavariPublicProducts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolveBusinessId(req: Request, body: Record<string, unknown>): string {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("businessId") ?? url.searchParams.get("business_id") ?? "";
  const fromBody = String(body.businessId ?? body.business_id ?? "");
  return (fromQuery || fromBody).trim();
}

function mapRowToTier(row: InventoryRow) {
  if (!row.expose_to_website_api || !row.website_show_admission_pricing || !isProductAvailable(row)) {
    return null;
  }
  const label = trimText(row.name);
  if (!label) return null;
  const priceFields = buildProductPriceFields(row);
  return {
    id: row.id,
    label,
    note: trimText(row.description),
    gatePrice: priceFields.gatePrice,
    gatePriceFormatted: priceFields.gatePriceFormatted,
    onlinePrice: priceFields.onlinePrice,
    onlinePriceFormatted: priceFields.onlinePriceFormatted,
    gateLabel: priceFields.gatePriceFormatted ? `${priceFields.gatePriceFormatted} at the gate` : "",
    onlineLabel: priceFields.onlinePriceFormatted ? `${priceFields.onlinePriceFormatted} online` : "",
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
    available: true,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = req.method === "POST"
      ? await req.json().catch(() => ({})) as Record<string, unknown>
      : {};
    const businessId = resolveBusinessId(req, body);

    if (!businessId || !UUID_RE.test(businessId)) {
      return jsonResponse({ ok: false, error: "Valid businessId is required." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      return jsonResponse({ ok: false, error: "Server configuration error." }, 500);
    }

    const supabase = createClient(url, key);

    const { data: moduleRow, error: moduleErr } = await supabase
      .from("business_module_usage")
      .select("enabled")
      .eq("business_id", businessId)
      .eq("module_key", "tavari_apis")
      .maybeSingle();

    if (moduleErr) {
      return jsonResponse({ ok: false, error: "Could not verify API access." }, 500);
    }

    if (!moduleRow?.enabled) {
      return jsonResponse({ ok: false, error: "Tavari APIs is not enabled for this business." }, 403);
    }

    const { data, error } = await supabase
      .from("pos_inventory")
      .select(INVENTORY_WEBSITE_SELECT_COLS)
      .eq("business_id", businessId)
      .eq("expose_to_website_api", true)
      .eq("website_show_admission_pricing", true)
      .or("is_active.eq.true,is_active.is.null")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      return jsonResponse({ ok: false, error: "Could not load admission rates." }, 500);
    }

    const tiers = [];
    for (const row of (data ?? []) as InventoryRow[]) {
      const mapped = mapRowToTier(row);
      if (mapped) tiers.push(mapped);
    }

    return jsonResponse({
      ok: true,
      businessId,
      deprecated: true,
      useInstead: "tavari-api-business-products?context=admission",
      tiers,
    });
  } catch (e) {
    console.error("[tavari-api-admission-rates]", e);
    return jsonResponse(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500,
    );
  }
});
