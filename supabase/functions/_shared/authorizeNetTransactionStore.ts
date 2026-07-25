import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AuthorizeNetTransactionDetails } from "./authorizeNetApi.ts";
import { transactionKindFromType } from "./authorizeNetApi.ts";

const SYNC_EVENT_TYPE = "net.authorize.payment.sync.import";

export type UpsertAuthorizeNetRowParams = {
  businessId: string;
  details: AuthorizeNetTransactionDetails;
  paymentSource: string;
  eventType?: string;
  eventDate?: string | null;
  summaryStatus?: string | null;
  rawWebhook?: Record<string, unknown>;
};

function normalizeStatus(
  details: AuthorizeNetTransactionDetails,
  summaryStatus?: string | null,
): string {
  const fromDetails = String(details.transactionStatus || "").trim().toLowerCase();
  if (fromDetails) return fromDetails;
  const fromSummary = String(summaryStatus || "").trim().toLowerCase();
  if (fromSummary) return fromSummary;
  if (details.responseCode === 1) return "approved";
  return "received";
}

export async function upsertAuthorizeNetTransactionRow(
  supabase: SupabaseClient,
  params: UpsertAuthorizeNetRowParams,
): Promise<{ ok: boolean; created: boolean; id?: string }> {
  const eventType = params.eventType || SYNC_EVENT_TYPE;
  const eventDate = params.eventDate ?? params.details.submitTimeUTC ?? params.details.submitTimeLocal ?? null;
  const amount = params.details.settleAmount ?? params.details.authAmount ?? null;

  const row = {
    business_id: params.businessId,
    trans_id: params.details.transId,
    event_type: eventType,
    event_date: eventDate,
    transaction_kind: transactionKindFromType(params.details.transactionType),
    amount,
    auth_code: params.details.authCode,
    response_code: params.details.responseCode,
    status: normalizeStatus(params.details, params.summaryStatus),
    card_last_four: params.details.cardLastFour,
    card_type: params.details.cardType,
    customer_email: params.details.customerEmail,
    customer_name: params.details.customerName,
    invoice_description: params.details.description || params.details.invoiceNumber,
    payment_source: params.paymentSource,
    raw_webhook: params.rawWebhook ?? { source: "sync" },
    raw_details: params.details.raw,
    fetched_details_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from("authorize_net_transactions")
    .select("id, event_type")
    .eq("business_id", params.businessId)
    .eq("trans_id", params.details.transId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("authorize_net_transactions")
      .update({
        ...row,
        event_type: existing.event_type?.includes("sync") ? eventType : existing.event_type,
      })
      .eq("id", existing.id);
    if (error) {
      console.error("[authorize.net store] update failed:", error.message);
      return { ok: false, created: false };
    }
    return { ok: true, created: false, id: existing.id as string };
  }

  const { data: inserted, error } = await supabase
    .from("authorize_net_transactions")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[authorize.net store] insert failed:", error.message);
    return { ok: false, created: false };
  }

  return { ok: true, created: true, id: inserted?.id as string | undefined };
}

export { SYNC_EVENT_TYPE };
