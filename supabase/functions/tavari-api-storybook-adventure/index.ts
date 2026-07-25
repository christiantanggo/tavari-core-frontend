// Public Storybook Explorer Adventure fulfillment — promo email + marketing list sync (OTWK website).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fulfillStorybookAdventureSubmission,
  validateStorybookFulfillmentInput,
} from "../_shared/tavariPublicStorybookAdventure.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_INTRO =
  "After a family completes the Storybook Explorer Adventure on your website, call fulfillSubmission to email their promo code through Tavari Mail and optionally add them to your marketing list.";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolveParams(req: Request, body: Record<string, unknown>) {
  const url = new URL(req.url);
  return {
    businessId: String(
      body.businessId ?? body.business_id ?? url.searchParams.get("businessId") ??
        url.searchParams.get("business_id") ?? "",
    ).trim(),
    action: String(body.action ?? url.searchParams.get("action") ?? "").trim(),
  };
}

async function assertTavariApisEnabled(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
) {
  const { data: moduleRow, error: moduleErr } = await supabase
    .from("business_module_usage")
    .select("enabled")
    .eq("business_id", businessId)
    .eq("module_key", "tavari_apis")
    .maybeSingle();

  if (moduleErr) throw new Error("Could not verify API access");
  if (!moduleRow?.enabled) throw new Error("Tavari APIs is not enabled for this business");
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
    const { businessId, action } = resolveParams(req, body);

    if (!businessId || !UUID_RE.test(businessId)) {
      return json({ ok: false, error: "Valid businessId is required." }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    await assertTavariApisEnabled(supabase, businessId);

    if (action === "getPortalInfo" || action === "") {
      const { data: business } = await supabase
        .from("businesses")
        .select("name")
        .eq("id", businessId)
        .maybeSingle();

      return json({
        ok: true,
        businessId,
        businessName: String(business?.name || "").trim(),
        intro: DEFAULT_INTRO,
        actions: ["getPortalInfo", "fulfillSubmission"],
      });
    }

    if (action !== "fulfillSubmission") {
      return json({ ok: false, error: "Supported actions: getPortalInfo, fulfillSubmission" }, 400);
    }

    const validated = validateStorybookFulfillmentInput({
      ...body,
      businessId,
      ipAddress: body.ipAddress ?? body.ip_address ?? req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"),
      userAgent: body.userAgent ?? body.user_agent ?? req.headers.get("user-agent"),
    });
    if (!validated.ok) {
      return json({ ok: false, error: validated.error }, 400);
    }

    const result = await fulfillStorybookAdventureSubmission(supabase, validated.input);

    return json({
      ok: true,
      businessId,
      entryId: validated.input.entryId,
      emailSent: result.emailSent,
      emailSkippedReason: result.emailSkippedReason ?? null,
      contactId: result.contactId ?? null,
      marketingSubscribed: result.marketingSubscribed,
      alreadyFulfilled: result.alreadyFulfilled ?? false,
    });
  } catch (error) {
    console.error("[tavari-api-storybook-adventure]", error);
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      500,
    );
  }
});
