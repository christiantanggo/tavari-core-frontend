// Public read-only inventory products exposed for external websites (POS → Expose to website API).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type InventoryRow,
  INVENTORY_WEBSITE_SELECT_COLS,
  mapInventoryToPublicProduct,
  parseWebsiteContext,
  type PublicProduct,
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

function parseIdsParam(req: Request, body: Record<string, unknown>): string[] {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("ids") ?? url.searchParams.get("id") ?? "";
  const fromBody = body.ids ?? body.id;
  const raw = fromQuery || (Array.isArray(fromBody) ? fromBody.join(",") : String(fromBody ?? ""));
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
}

function emptyUnavailableProduct(id: string, reason: PublicProduct["unavailableReason"]): PublicProduct {
  return {
    id,
    name: "",
    description: "",
    price: 0,
    priceFormatted: "",
    gatePrice: 0,
    gatePriceFormatted: "",
    onlinePrice: null,
    onlinePriceFormatted: null,
    imageUrl: "",
    sortOrder: 0,
    available: false,
    unavailableReason: reason,
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
    const ids = parseIdsParam(req, body);
    const context = parseWebsiteContext(req, body);

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
      console.error("[tavari-api-business-products] module check", moduleErr);
      return jsonResponse({ ok: false, error: "Could not verify API access." }, 500);
    }

    if (!moduleRow?.enabled) {
      return jsonResponse(
        { ok: false, error: "Tavari APIs is not enabled for this business." },
        403,
      );
    }

    if (ids.length > 0) {
      const { data, error } = await supabase
        .from("pos_inventory")
        .select(INVENTORY_WEBSITE_SELECT_COLS)
        .eq("business_id", businessId)
        .in("id", ids);

      if (error) {
        console.error("[tavari-api-business-products] ids lookup", error);
        return jsonResponse({ ok: false, error: "Could not load products." }, 500);
      }

      const byId = new Map((data ?? []).map((r) => [r.id, r as InventoryRow]));
      const products: PublicProduct[] = [];

      for (const id of ids) {
        const row = byId.get(id);
        if (!row) {
          products.push(emptyUnavailableProduct(id, "not_found"));
          continue;
        }
        const mapped = mapInventoryToPublicProduct(row, {
          includeWhenUnavailable: true,
          context,
        });
        if (mapped) {
          products.push(mapped);
        } else if (context) {
          products.push(emptyUnavailableProduct(id, "not_exposed"));
        }
      }

      return jsonResponse({
        ok: true,
        businessId,
        ...(context ? { context } : {}),
        products,
      });
    }

    let query = supabase
      .from("pos_inventory")
      .select(INVENTORY_WEBSITE_SELECT_COLS)
      .eq("business_id", businessId)
      .eq("expose_to_website_api", true)
      .or("is_active.eq.true,is_active.is.null");

    if (context === "admission") {
      query = query.eq("website_show_admission_pricing", true);
    }

    const { data, error } = await query
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("[tavari-api-business-products] list lookup", error);
      return jsonResponse({ ok: false, error: "Could not load products." }, 500);
    }

    const products: PublicProduct[] = [];
    for (const row of (data ?? []) as InventoryRow[]) {
      const mapped = mapInventoryToPublicProduct(row, { context });
      if (mapped) products.push(mapped);
    }

    return jsonResponse({
      ok: true,
      businessId,
      ...(context ? { context } : {}),
      products,
    });
  } catch (e) {
    console.error("[tavari-api-business-products]", e);
    return jsonResponse(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500,
    );
  }
});
