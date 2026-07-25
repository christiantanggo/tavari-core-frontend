import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  encryptSecret,
  hintFromSecret,
  isCloverConfigured,
} from "../_shared/cloverBusinessCredentials.ts";
import {
  buildCloverAuthorizeUrl,
  cloverOAuthRedirectUri,
  exchangeCloverOAuthCode,
  expiresAtFromUnix,
} from "../_shared/cloverOAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MANAGER_ROLES = new Set(["owner", "manager", "admin"]);

function parseBool(value: unknown, fallback = false): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function parsePaymentSource(value: unknown, fallback: string): string {
  const s = value != null ? String(value).trim().toLowerCase() : '';
  return s || fallback;
}

function parseBusinessId(body: Record<string, unknown>): string {
  return String(body.businessId || body.business_id || "").trim();
}

function parseMerchantId(value: unknown): string {
  return value != null ? String(value).trim() : '';
}

function parseSecret(value: unknown): string {
  return value != null ? String(value).trim() : '';
}

async function loadExistingRow(
  admin: ReturnType<typeof createClient>,
  businessId: string,
) {
  return admin
    .from("business_clover_credentials")
    .select(
      "merchant_id, api_token_encrypted, api_token_hint, oauth_access_token_encrypted, oauth_refresh_token_encrypted, access_token_expires_at, clover_auth_code_encrypted, pending_webhook_verification_code, sandbox, payment_source",
    )
    .eq("business_id", businessId)
    .maybeSingle();
}

function webhookUrlForBusiness(businessId: string): string {
  const base = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  return `${base}/functions/v1/clover-webhook/${businessId}`;
}

function buildGetResponse(row: Record<string, unknown> | null, businessId: string) {
  const oauthConfigured = !!(row?.oauth_access_token_encrypted);
  const apiTokenConfigured = !!(row?.api_token_hint);
  return new Response(
    JSON.stringify({
      configured: isCloverConfigured(row),
      merchantId: typeof row?.merchant_id === "string" ? row.merchant_id.trim() || null : null,
      apiTokenHint: row?.api_token_hint || null,
      oauthConfigured,
      authMethod: oauthConfigured ? "oauth" : apiTokenConfigured ? "api_token" : null,
      authCodeConfigured: !!(row?.clover_auth_code_encrypted),
      pendingWebhookVerificationCode:
        typeof row?.pending_webhook_verification_code === "string" &&
        row.pending_webhook_verification_code.trim()
          ? row.pending_webhook_verification_code.trim()
          : null,
      sandbox: row?.sandbox === true,
      paymentSource:
        typeof row?.payment_source === "string" && row.payment_source.trim()
          ? row.payment_source.trim()
          : "clover_pos",
      webhookUrl: webhookUrlForBusiness(businessId),
      oauthRedirectUrl: cloverOAuthRedirectUri(),
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

async function handleGet(
  admin: ReturnType<typeof createClient>,
  businessId: string,
) {
  const { data: row } = await loadExistingRow(admin, businessId);
  return buildGetResponse(row, businessId);
}

async function handleClear(
  admin: ReturnType<typeof createClient>,
  businessId: string,
) {
  await admin.from("business_clover_credentials").delete().eq("business_id", businessId);
  return new Response(JSON.stringify({ ok: true, cleared: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveAuthCode(
  authCodeRaw: string,
  body: Record<string, unknown>,
  existingEncrypted: string | null | undefined,
): Promise<string | null> {
  if (authCodeRaw) return await encryptSecret(authCodeRaw);
  if (body.clearAuthCode === true || body.clearAuthCode === "true") return null;
  return existingEncrypted ?? null;
}

async function handleSave(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  body: Record<string, unknown>,
) {
  const merchantIdRaw = parseMerchantId(body.merchantId ?? body.merchant_id);
  const apiTokenRaw = parseSecret(body.apiToken ?? body.api_token);
  const authCodeRaw = parseSecret(body.cloverAuthCode ?? body.clover_auth_code);
  const sandbox = parseBool(body.sandbox, true);
  const paymentSource = parsePaymentSource(body.paymentSource ?? body.payment_source, "clover_pos");

  const { data: existing } = await loadExistingRow(admin, businessId);

  let merchantId = typeof existing?.merchant_id === "string" ? existing.merchant_id.trim() : '';
  if (merchantIdRaw) merchantId = merchantIdRaw;

  let apiTokenEncrypted = existing?.api_token_encrypted as string | undefined;
  let apiTokenHint = existing?.api_token_hint as string | undefined;

  if (apiTokenRaw) {
    apiTokenEncrypted = await encryptSecret(apiTokenRaw);
    apiTokenHint = hintFromSecret(apiTokenRaw);
  }

  const existingOauth = !!(existing?.oauth_access_token_encrypted);

  if (!apiTokenEncrypted && !existingOauth && !parseSecret(body.oauthCode ?? body.code)) {
    return new Response(
      JSON.stringify({
        error:
          "API token is required on first save, or use Connect Clover to authorize with OAuth.",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!merchantId) {
    return new Response(JSON.stringify({ error: "Merchant ID is required." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authCodeOut = await resolveAuthCode(
    authCodeRaw,
    body,
    existing?.clover_auth_code_encrypted as string | null | undefined,
  );

  const upsertRow: Record<string, unknown> = {
    business_id: businessId,
    merchant_id: merchantId,
    clover_auth_code_encrypted: authCodeOut,
    sandbox,
    payment_source: paymentSource,
  };

  if (apiTokenEncrypted) {
    upsertRow.api_token_encrypted = apiTokenEncrypted;
    upsertRow.api_token_hint = apiTokenHint ?? "******";
    if (apiTokenRaw) {
      upsertRow.oauth_access_token_encrypted = null;
      upsertRow.oauth_refresh_token_encrypted = null;
      upsertRow.access_token_expires_at = null;
      upsertRow.refresh_token_expires_at = null;
    }
  } else if (existing?.api_token_encrypted) {
    upsertRow.api_token_encrypted = existing.api_token_encrypted;
    upsertRow.api_token_hint = existing.api_token_hint;
  }

  const { error: upsertErr } = await admin
    .from("business_clover_credentials")
    .upsert(upsertRow, { onConflict: "business_id" });

  if (upsertErr) {
    console.error("[business-clover-credentials]", upsertErr);
    return new Response(JSON.stringify({ error: upsertErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleConnectUrl(
  businessId: string,
  body: Record<string, unknown>,
) {
  const merchantId = parseMerchantId(body.merchantId ?? body.merchant_id);
  const sandbox = parseBool(body.sandbox, false);

  if (!merchantId) {
    return jsonError("merchantId is required to start Clover OAuth", 400);
  }

  const authorizeUrl = buildCloverAuthorizeUrl({ merchantId, sandbox });
  if (!authorizeUrl) {
    return jsonError(
      "Clover app credentials are not configured on the server (CLOVER_APP_ID / CLOVER_APP_SECRET).",
      500,
    );
  }

  return new Response(
    JSON.stringify({ ok: true, authorizeUrl, redirectUri: cloverOAuthRedirectUri() }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

async function handleExchangeCode(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  body: Record<string, unknown>,
) {
  const code = parseSecret(body.code ?? body.oauthCode);
  const merchantId = parseMerchantId(body.merchantId ?? body.merchant_id);
  const sandbox = parseBool(body.sandbox, false);

  if (!code) return jsonError("OAuth code is required", 400);
  if (!merchantId) return jsonError("merchantId is required", 400);

  const tokens = await exchangeCloverOAuthCode({ code, sandbox });
  if (!tokens?.access_token) {
    return jsonError("Clover OAuth token exchange failed. Check app credentials and try again.", 400);
  }

  const upsertRow = {
    business_id: businessId,
    merchant_id: merchantId,
    sandbox,
    payment_source: "clover_pos",
    api_token_encrypted: null,
    api_token_hint: hintFromSecret(tokens.access_token),
    oauth_access_token_encrypted: await encryptSecret(tokens.access_token),
    oauth_refresh_token_encrypted: tokens.refresh_token
      ? await encryptSecret(tokens.refresh_token)
      : null,
    access_token_expires_at: expiresAtFromUnix(tokens.access_token_expiration),
    refresh_token_expires_at: expiresAtFromUnix(tokens.refresh_token_expiration),
  };

  const { error: upsertErr } = await admin
    .from("business_clover_credentials")
    .upsert(upsertRow, { onConflict: "business_id" });

  if (upsertErr) {
    console.error("[business-clover-credentials] oauth exchange", upsertErr);
    return jsonError(upsertErr.message, 500);
  }

  return new Response(JSON.stringify({ ok: true, merchantId, sandbox, authMethod: "oauth" }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authorizeManager(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  userId: string,
): Promise<boolean> {
  const { data: membership, error: memErr } = await admin
    .from("business_users")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();

  return !memErr && !!membership?.role && MANAGER_ROLES.has(String(membership.role));
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function parseRequestBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function authenticateUser(req: Request) {
  const authHeader = req.headers.get("Authorization") || '';
  if (!authHeader) return { user: null, admin: null };

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return { user: null, admin: null };

  const admin = createClient(supabaseUrl, serviceKey);
  return { user, admin };
}

async function dispatchAction(
  action: string,
  admin: ReturnType<typeof createClient>,
  businessId: string,
  body: Record<string, unknown>,
) {
  if (action === "get") return handleGet(admin, businessId);
  if (action === "connecturl" || action === "connect_url") {
    return handleConnectUrl(businessId, body);
  }
  if (action === "exchange" || action === "exchange_code") {
    return handleExchangeCode(admin, businessId, body);
  }

  if (action !== "save") return jsonError("Unknown action", 400);

  const clearAll = body.clearAll === true || body.clearAll === "true";
  if (clearAll) return handleClear(admin, businessId);

  return handleSave(admin, businessId, body);
}

async function handlePost(req: Request) {
  const auth = await authenticateUser(req);
  if (!auth.user || !auth.admin) return jsonError("Unauthorized", 401);

  const body = await parseRequestBody(req);
  const action = String(body.action || "get").trim().toLowerCase();
  const businessId = parseBusinessId(body);

  if (!businessId) return jsonError("businessId is required", 400);

  const allowed = await authorizeManager(auth.admin, businessId, auth.user.id);
  if (!allowed) return jsonError("Forbidden for this business", 403);

  return dispatchAction(action, auth.admin, businessId, body);
}

function handleOptions() {
  return new Response("ok", { status: 200, headers: corsHeaders });
}

function handleUnsupportedMethod() {
  return jsonError("Method not allowed", 405);
}

async function routeRequest(req: Request) {
  if (req.method === "OPTIONS") return handleOptions();
  if (req.method !== "POST") return handleUnsupportedMethod();
  return handlePost(req);
}

Deno.serve(async (req) => routeRequest(req));
