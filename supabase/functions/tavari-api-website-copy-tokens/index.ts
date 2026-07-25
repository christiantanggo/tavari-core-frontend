// Unified {{token}} map for external marketing sites (OTWK builder, FAQs, SEO).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  DEFAULT_GRIP_SOCKS_PRODUCT_ID,
  loadPublicWebsiteCopyTokens,
} from "../_shared/tavariPublicWebsiteCopyTokens.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolveBusinessId(req: Request, body: Record<string, unknown>): string {
  const url = new URL(req.url);
  return String(
    body.businessId ?? body.business_id ?? url.searchParams.get("businessId") ??
      url.searchParams.get("business_id") ?? "",
  ).trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const body = req.method === "POST"
      ? await req.json().catch(() => ({})) as Record<string, unknown>
      : {};
    const businessId = resolveBusinessId(req, body);

    if (!businessId || !UUID_RE.test(businessId)) {
      return json({ ok: false, error: "Valid businessId is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: moduleRow, error: moduleErr } = await supabase
      .from("business_module_usage")
      .select("enabled")
      .eq("business_id", businessId)
      .eq("module_key", "tavari_apis")
      .maybeSingle();

    if (moduleErr) {
      console.error("[tavari-api-website-copy-tokens] module check", moduleErr);
      return json({ ok: false, error: "Could not verify API access" }, 500);
    }

    if (!moduleRow?.enabled) {
      return json({ ok: false, error: "Tavari APIs is not enabled for this business" }, 403);
    }

    const gripSocksProductId = String(
      body.gripSocksProductId ?? body.grip_socks_product_id ??
        url.searchParams.get("gripSocksProductId") ??
        url.searchParams.get("grip_socks_product_id") ??
        DEFAULT_GRIP_SOCKS_PRODUCT_ID,
    ).trim();

    const payload = await loadPublicWebsiteCopyTokens(supabase, businessId, {
      gripSocksProductId,
    });

    return json(payload as unknown as Record<string, unknown>);
  } catch (error) {
    console.error("[tavari-api-website-copy-tokens]", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Internal error",
    }, 500);
  }
});
