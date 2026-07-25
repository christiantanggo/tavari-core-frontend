import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  encryptSecret,
  hintFromSecret,
} from "../_shared/helcimBusinessCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MANAGER_ROLES = new Set(["owner", "manager", "admin"]);

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

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();

  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* ignore */
  }

  const action = String(body.action || "get").trim().toLowerCase();
  const businessId = String(body.businessId || body.business_id || "").trim();

  if (!businessId) {
    return new Response(JSON.stringify({ error: "businessId is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: membership, error: memErr } = await admin
    .from("business_users")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memErr || !membership?.role || !MANAGER_ROLES.has(String(membership.role))) {
    return new Response(JSON.stringify({ error: "Forbidden for this business" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (action === "get") {
    const { data: row } = await admin
      .from("business_helcim_credentials")
      .select("api_token_hint, helcim_account_id, webhook_verifier_encrypted")
      .eq("business_id", businessId)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        configured: !!(row?.api_token_hint),
        apiTokenHint: row?.api_token_hint || null,
        helcimAccountId: row?.helcim_account_id?.trim() || null,
        webhookVerifierConfigured: !!(row?.webhook_verifier_encrypted),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (action !== "save") {
    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const clearAll = body.clearAll === true || body.clearAll === "true";

  if (clearAll) {
    await admin.from("business_helcim_credentials").delete().eq("business_id", businessId);
    return new Response(JSON.stringify({ ok: true, cleared: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiTokenRaw = body.apiToken != null ? String(body.apiToken).trim() : "";
  const webhookVerifierRaw = body.webhookVerifierToken != null
    ? String(body.webhookVerifierToken).trim()
    : "";
  const helcimAccountIdRaw = body.helcimAccountId != null
    ? String(body.helcimAccountId).trim()
    : "";

  const { data: existing } = await admin
    .from("business_helcim_credentials")
    .select("api_token_encrypted, api_token_hint, webhook_verifier_encrypted, helcim_account_id")
    .eq("business_id", businessId)
    .maybeSingle();

  let apiTokenEncrypted = existing?.api_token_encrypted as string | undefined;
  let apiTokenHint = existing?.api_token_hint as string | undefined;

  if (apiTokenRaw) {
    apiTokenEncrypted = await encryptSecret(apiTokenRaw);
    apiTokenHint = hintFromSecret(apiTokenRaw);
  }

  if (!apiTokenEncrypted) {
    return new Response(
      JSON.stringify({
        error:
          "API token is required on first save. Leave blank only when updating webhook or account ID and credentials already exist.",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let webhookVerifierOut: string | null;
  if (webhookVerifierRaw) {
    webhookVerifierOut = await encryptSecret(webhookVerifierRaw);
  } else if (body.clearWebhookVerifier === true || body.clearWebhookVerifier === "true") {
    webhookVerifierOut = null;
  } else {
    webhookVerifierOut = (existing?.webhook_verifier_encrypted as string | undefined) ?? null;
  }

  let helcimAccountId: string | null =
    typeof existing?.helcim_account_id === "string" ? existing.helcim_account_id.trim() || null : null;
  if (body.helcimAccountId !== undefined && body.helcimAccountId !== null) {
    helcimAccountId = helcimAccountIdRaw ? helcimAccountIdRaw : null;
  }

  const upsertRow: Record<string, unknown> = {
    business_id: businessId,
    api_token_encrypted: apiTokenEncrypted,
    api_token_hint: apiTokenHint ?? "******",
    helcim_account_id: helcimAccountId,
    webhook_verifier_encrypted: webhookVerifierOut,
  };

  const { error: upsertErr } = await admin.from("business_helcim_credentials").upsert(upsertRow, {
    onConflict: "business_id",
  });

  if (upsertErr) {
    console.error("[business-helcim-credentials]", upsertErr);
    return new Response(JSON.stringify({ error: upsertErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
