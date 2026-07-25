import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  encryptSecret,
  hintFromSecret,
} from "../_shared/authorizeNetBusinessCredentials.ts";

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

function parseApiLoginId(value: unknown): string {
  return value != null ? String(value).trim() : '';
}

function parseSecret(value: unknown): string {
  return value != null ? String(value).trim() : '';
}

function parseBusinessId(body: Record<string, unknown>): string {
  return String(body.businessId || body.business_id || "").trim();
}

async function loadExistingRow(
  admin: ReturnType<typeof createClient>,
  businessId: string,
) {
  return admin
    .from("business_authorize_net_credentials")
    .select(
      "api_login_id, transaction_key_encrypted, transaction_key_hint, signature_key_encrypted, sandbox, payment_source",
    )
    .eq("business_id", businessId)
    .maybeSingle();
}

function webhookUrlForBusiness(businessId: string): string {
  const base = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  return `${base}/functions/v1/authorize-net-webhook/${businessId}`;
}

function buildGetResponse(row: Record<string, unknown> | null, businessId: string) {
  return new Response(
    JSON.stringify({
      configured: !!(row?.transaction_key_hint),
      apiLoginId: typeof row?.api_login_id === "string" ? row.api_login_id.trim() || null : null,
      transactionKeyHint: row?.transaction_key_hint || null,
      signatureKeyConfigured: !!(row?.signature_key_encrypted),
      sandbox: row?.sandbox === true,
      paymentSource:
        typeof row?.payment_source === "string" && row.payment_source.trim()
          ? row.payment_source.trim()
          : "bookeo",
      webhookUrl: webhookUrlForBusiness(businessId),
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
  await admin.from("business_authorize_net_credentials").delete().eq("business_id", businessId);
  return new Response(JSON.stringify({ ok: true, cleared: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveSignatureKey(
  signatureKeyRaw: string,
  body: Record<string, unknown>,
  existingEncrypted: string | null | undefined,
): Promise<string | null> {
  if (signatureKeyRaw) return encryptSecret(signatureKeyRaw);
  if (body.clearSignatureKey === true || body.clearSignatureKey === "true") return null;
  return existingEncrypted ?? null;
}

async function handleSave(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  body: Record<string, unknown>,
) {
  const apiLoginIdRaw = parseApiLoginId(body.apiLoginId ?? body.api_login_id);
  const transactionKeyRaw = parseSecret(body.transactionKey ?? body.transaction_key);
  const signatureKeyRaw = parseSecret(body.signatureKey ?? body.signature_key);
  const sandbox = parseBool(body.sandbox, false);
  const paymentSource = parsePaymentSource(body.paymentSource ?? body.payment_source, "bookeo");

  const { data: existing } = await loadExistingRow(admin, businessId);

  let apiLoginId = typeof existing?.api_login_id === "string" ? existing.api_login_id.trim() : '';
  if (apiLoginIdRaw) apiLoginId = apiLoginIdRaw;

  let transactionKeyEncrypted = existing?.transaction_key_encrypted as string | undefined;
  let transactionKeyHint = existing?.transaction_key_hint as string | undefined;

  if (transactionKeyRaw) {
    transactionKeyEncrypted = await encryptSecret(transactionKeyRaw);
    transactionKeyHint = hintFromSecret(transactionKeyRaw);
  }

  if (!transactionKeyEncrypted) {
    return new Response(
      JSON.stringify({
        error:
          "Transaction key is required on first save. Leave blank only when updating other fields and credentials already exist.",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!apiLoginId) {
    return new Response(JSON.stringify({ error: "API Login ID is required." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const signatureKeyOut = await resolveSignatureKey(
    signatureKeyRaw,
    body,
    existing?.signature_key_encrypted as string | null | undefined,
  );

  const upsertRow = {
    business_id: businessId,
    api_login_id: apiLoginId,
    transaction_key_encrypted: transactionKeyEncrypted,
    transaction_key_hint: transactionKeyHint ?? "******",
    signature_key_encrypted: signatureKeyOut,
    sandbox,
    payment_source: paymentSource,
  };

  const { error: upsertErr } = await admin
    .from("business_authorize_net_credentials")
    .upsert(upsertRow, { onConflict: "business_id" });

  if (upsertErr) {
    console.error("[business-authorize-net-credentials]", upsertErr);
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

// eslint-disable-next-line @typescript-eslint/no-misused-promises
Deno.serve(async (req) => routeRequest(req));
