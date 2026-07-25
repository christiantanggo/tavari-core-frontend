import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAuthorizeNetTransactionDetails } from "../_shared/authorizeNetApi.ts";
import { getAuthorizeNetCredentialsForBusiness } from "../_shared/authorizeNetBusinessCredentials.ts";
import { verifyAuthorizeNetWebhook } from "../_shared/authorizeNetWebhookVerification.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-anet-signature",
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

function transactionKindFromEvent(eventType: string): string {
  const event = String(eventType || "").toLowerCase();
  if (event.includes("refund")) return "refund";
  if (event.includes("void")) return "void";
  if (event.includes("authorization") && !event.includes("authcapture")) return "authorization";
  if (event.includes("capture")) return "capture";
  if (event.includes("authcapture")) return "sale";
  if (event.includes("fraud.held")) return "fraud_held";
  if (event.includes("fraud.approved")) return "fraud_approved";
  if (event.includes("fraud.declined")) return "fraud_declined";
  return "other";
}

function statusFromEvent(eventType: string, responseCode: number | null): string {
  const kind = transactionKindFromEvent(eventType);
  if (kind === "refund") return "refunded";
  if (kind === "void") return "voided";
  if (kind === "fraud_held") return "held";
  if (kind === "fraud_declined") return "declined";
  if (responseCode === 1) return "approved";
  if (responseCode === 4) return "held";
  if (responseCode != null && responseCode !== 1) return "declined";
  return "received";
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function isPaymentEvent(eventType: string): boolean {
  return String(eventType || "").toLowerCase().includes("net.authorize.payment.");
}

async function upsertTransactionRow(params: {
  businessId: string;
  body: Record<string, unknown>;
  paymentSource: string;
}) {
  const { businessId, body, paymentSource } = params;
  const eventType = asString(body.eventType) || "unknown";
  const payload = (typeof body.payload === "object" && body.payload !== null
    ? body.payload
    : {}) as Record<string, unknown>;

  const transId = asString(payload.id);
  if (!transId) {
    console.log("[authorize.net webhook] No transaction id in payload, ignoring");
    return;
  }

  const notificationId = asString(body.notificationId);
  const eventDate = asString(body.eventDate);
  const responseCode = asNumber(payload.responseCode);
  const amount = asNumber(payload.authAmount ?? payload.settleAmount);

  const baseRow = {
    business_id: businessId,
    trans_id: transId,
    notification_id: notificationId,
    event_type: eventType,
    event_date: eventDate,
    transaction_kind: transactionKindFromEvent(eventType),
    amount,
    auth_code: asString(payload.authCode),
    response_code: responseCode,
    merchant_reference_id: asString(payload.merchantReferenceId),
    avs_response: asString(payload.avsResponse),
    status: statusFromEvent(eventType, responseCode),
    payment_source: paymentSource,
    raw_webhook: body,
  };

  const { data: upserted, error: upsertErr } = await supabase
    .from("authorize_net_transactions")
    .upsert(baseRow, { onConflict: "business_id,trans_id,event_type" })
    .select("id")
    .maybeSingle();

  if (upsertErr) {
    console.error("[authorize.net webhook] upsert failed:", upsertErr.message);
    return;
  }

  const rowId = upserted?.id as string | undefined;

  const creds = await getAuthorizeNetCredentialsForBusiness(supabase, businessId);
  if (!creds || !rowId) return;

  try {
    const details = await fetchAuthorizeNetTransactionDetails(creds, transId);
    if (!details) return;

    await supabase
      .from("authorize_net_transactions")
      .update({
        amount: details.settleAmount ?? details.authAmount ?? amount,
        auth_code: details.authCode ?? baseRow.auth_code,
        response_code: details.responseCode ?? responseCode,
        card_last_four: details.cardLastFour,
        card_type: details.cardType,
        customer_email: details.customerEmail,
        customer_name: details.customerName,
        invoice_description: details.description || details.invoiceNumber,
        status: asString(details.transactionStatus)?.toLowerCase() || baseRow.status,
        raw_details: details.raw,
        fetched_details_at: new Date().toISOString(),
      })
      .eq("id", rowId);
  } catch (e) {
    console.error("[authorize.net webhook] details fetch failed:", e);
  }
}

async function handleWebhookPost(req: Request, businessId: string) {
  const creds = await getAuthorizeNetCredentialsForBusiness(supabase, businessId);
  if (!creds) {
    console.error("[authorize.net webhook] No credentials for business", businessId);
    return okResponse();
  }

  const bodyText = await req.text();
  if (!bodyText.trim()) return okResponse();

  const verification = await verifyAuthorizeNetWebhook({
    req,
    bodyText,
    businessId,
    supabase,
  });
  if (!verification.ok) {
    console.error("[authorize.net webhook]", verification.error);
    return new Response(verification.error, {
      status: verification.status,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return okResponse();
  }

  const eventType = asString(body.eventType) || '';
  if (!isPaymentEvent(eventType)) {
    console.log("[authorize.net webhook] Ignoring non-payment event:", eventType);
    return okResponse();
  }

  await upsertTransactionRow({
    businessId,
    body,
    paymentSource: creds.paymentSource,
  });

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
    console.error("[authorize.net webhook] unhandled error:", e);
    return okResponse();
  }
});
