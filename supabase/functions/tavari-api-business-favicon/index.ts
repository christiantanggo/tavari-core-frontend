// Public read-only business favicon (Dashboard → Settings → Basic Information → Favicon, app_branding.favicon_url).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      console.error("[tavari-api-business-favicon] module check", moduleErr);
      return jsonResponse({ ok: false, error: "Could not verify API access." }, 500);
    }

    if (!moduleRow?.enabled) {
      return jsonResponse(
        { ok: false, error: "Tavari APIs is not enabled for this business." },
        403,
      );
    }

    const { data: business, error: bizErr } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", businessId)
      .maybeSingle();

    if (bizErr) {
      console.error("[tavari-api-business-favicon] business lookup", bizErr);
      return jsonResponse({ ok: false, error: "Could not load business." }, 500);
    }

    if (!business) {
      return jsonResponse({ ok: false, error: "Business not found." }, 404);
    }

    const { data: branding, error: brandingErr } = await supabase
      .from("app_branding")
      .select("favicon_url")
      .eq("business_id", businessId)
      .maybeSingle();

    if (brandingErr) {
      console.error("[tavari-api-business-favicon] branding lookup", brandingErr);
      return jsonResponse({ ok: false, error: "Could not load business favicon." }, 500);
    }

    const faviconUrl = typeof branding?.favicon_url === "string" ? branding.favicon_url.trim() : "";

    return jsonResponse({
      ok: true,
      businessId: business.id,
      faviconUrl,
    });
  } catch (e) {
    console.error("[tavari-api-business-favicon]", e);
    return jsonResponse(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500,
    );
  }
});
