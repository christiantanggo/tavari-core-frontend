import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchCloverPaymentDetails } from "../_shared/cloverApi.ts";
import { getCloverCredentialsForBusiness } from "../_shared/cloverBusinessCredentials.ts";
import { upsertCloverTransactionRow } from "../_shared/cloverTransactionStore.ts";
import { verifyCloverWebhook } from "../_shared/cloverWebhookVerification.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-clover-auth",
  "Access-Control-Allow-Methods": "POST, GET, HEAD, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function okResponse(message = "OK") {
  return new Response(message, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/plain" },
  });
}

function parseBusinessIdFromUrl(req: Request): string | null {
  const url = new URL(req.url);
  const queryId = url.searchParams.get("businessId") || url.searchParams.get("business_id");
  if (queryId && UUID_RE.test(queryId.trim())) return queryId.trim();

  const parts = url.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || '';
  if (UUID_RE.test(last)) return last;

  return null;
}

function parsePaymentId(objectId: string): string | null {
  const id = String(objectId || "").trim();
  if (!id.startsWith("P:")) return null;
  const paymentId = id.slice(2).trim();
  return paymentId || null;
}

async function processPaymentUpdate(params: {
  businessId: string;
  merchantId: string;
  paymentId: string;
  updateType: string;
  ts: number | null;
  rawWebhook: Record<string, unknown>;
  paymentSource: string;
}) {
  const notificationKey = `${params.merchantId}:${params.paymentId}:${params.updateType}:${params.ts ?? ''}`;

  const creds = await getCloverCredentialsForBusiness(supabase, params.businessId);
  if (!creds) return;

  if (creds.merchantId !== params.merchantId) {
    console.log("[clover webhook] merchant mismatch", params.merchantId, creds.merchantId);
    return;
  }

  const details = await fetchCloverPaymentDetails(creds, params.paymentId);
  if (!details) return;

  await upsertCloverTransactionRow(supabase, {
    businessId: params.businessId,
    details,
    paymentSource: params.paymentSource,
    eventType: `clover.payment.${params.updateType.toLowerCase()}`,
    eventDate: params.ts ? new Date(params.ts).toISOString() : details.createdTime,
    notificationKey,
    rawWebhook: params.rawWebhook,
  });
}

async function handleWebhookPost(req: Request, businessId: string) {
  const bodyText = await req.text();
  if (!bodyText.trim()) return okResponse();

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return okResponse();
  }

  if (body.verificationCode) {
    const code = String(body.verificationCode).trim();
    console.log("[clover webhook] VERIFICATION CODE (paste in Clover):", code);
    await supabase
      .from("business_clover_credentials")
      .update({ pending_webhook_verification_code: code })
      .eq("business_id", businessId);
    return new Response(code, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }

  const creds = await getCloverCredentialsForBusiness(supabase, businessId);
  if (!creds) {
    console.error("[clover webhook] No credentials for business", businessId);
    return okResponse();
  }

  const verification = await verifyCloverWebhook({ req, businessId, supabase });
  if (!verification.ok) {
    console.error("[clover webhook]", verification.error);
    return new Response(verification.error, {
      status: verification.status,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }

  const merchants = body.merchants;
  if (!merchants || typeof merchants !== "object") {
    return okResponse();
  }

  for (const [merchantId, updates] of Object.entries(merchants as Record<string, unknown>)) {
    if (!Array.isArray(updates)) continue;

    for (const update of updates) {
      if (!update || typeof update !== "object") continue;
      const row = update as Record<string, unknown>;
      const objectId = String(row.objectId || "").trim();
      const paymentId = parsePaymentId(objectId);
      if (!paymentId) continue;

      const updateType = String(row.type || "UPDATE").trim().toUpperCase();
      const ts = Number(row.ts);
      const tsValue = Number.isFinite(ts) ? ts : null;

      await processPaymentUpdate({
        businessId,
        merchantId,
        paymentId,
        updateType,
        ts: tsValue,
        rawWebhook: body,
        paymentSource: creds.paymentSource,
      });
    }
  }

  return okResponse();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return okResponse();
  if (req.method === "GET" || req.method === "HEAD") return okResponse();

  const businessId = parseBusinessIdFromUrl(req);
  if (!businessId) {
    return new Response("Missing business id in webhook URL", {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }

  if (req.method !== "POST") return okResponse();

  try {
    return await handleWebhookPost(req, businessId);
  } catch (e) {
    console.error("[clover webhook] unhandled error:", e);
    return okResponse();
  }
});
