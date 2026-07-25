// Public camp registration portal info for external websites (OTWK).

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

const DEFAULT_FORM_TITLE = "Camp Registration & Medical Form";
const DEFAULT_FORM_INTRO =
  "Complete this form once per camper each year before attending camp. Sign in with the phone number on your booking account, then select each child to complete or update their registration and medical form.";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolveHostPortalUrl(businessId: string) {
  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://www.tavarios.ca").replace(/\/$/, "");
  return `${siteUrl}/customer-portal/${businessId}/camp-registration`;
}

function resolveRequestParams(req: Request, body: Record<string, unknown>) {
  const url = new URL(req.url);
  const businessId = String(
    body.businessId
      ?? body.business_id
      ?? url.searchParams.get("businessId")
      ?? url.searchParams.get("business_id")
      ?? "",
  ).trim();
  const action = String(body.action ?? url.searchParams.get("action") ?? "").trim();
  return { businessId, action };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = req.method === "POST"
      ? await req.json().catch(() => ({})) as Record<string, unknown>
      : {};
    const { businessId, action } = resolveRequestParams(req, body);

    if (!UUID_RE.test(businessId)) {
      return json({ ok: false, error: "Valid businessId is required." }, 400);
    }

    if (action !== "getPortalInfo") {
      return json({ ok: false, error: "Supported action: getPortalInfo" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: moduleRow, error: moduleErr } = await supabase
      .from("business_module_usage")
      .select("enabled")
      .eq("business_id", businessId)
      .eq("module_key", "tavari_apis")
      .maybeSingle();

    if (moduleErr) {
      console.error("[tavari-api-camp-registration] module check", moduleErr);
      return json({ ok: false, error: "Could not verify API access." }, 500);
    }

    if (!moduleRow?.enabled) {
      return json({ ok: false, error: "Tavari APIs is not enabled for this business." }, 403);
    }

    const [{ data: business }, { data: template }] = await Promise.all([
      supabase.from("businesses").select("name").eq("id", businessId).maybeSingle(),
      supabase
        .from("camper_registration_form_templates")
        .select("form_title, form_intro, website_portal_url, is_active")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);

    const formTitle = String(template?.form_title || DEFAULT_FORM_TITLE).trim() || DEFAULT_FORM_TITLE;
    const formIntro = String(template?.form_intro || DEFAULT_FORM_INTRO).trim() || DEFAULT_FORM_INTRO;
    const websitePortalUrl = String(
      template?.website_portal_url ?? Deno.env.get("CAMP_REGISTRATION_WEBSITE_URL") ?? "",
    ).trim() || null;

    return json({
      ok: true,
      businessId,
      businessName: String(business?.name || "").trim(),
      formTitle,
      formIntro,
      hostPortalUrl: resolveHostPortalUrl(businessId),
      websitePortalUrl,
      portalActive: template?.is_active !== false,
    });
  } catch (e) {
    console.error("[tavari-api-camp-registration]", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, 500);
  }
});
