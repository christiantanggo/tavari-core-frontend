import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { CloverPaymentDetails } from "./cloverApi.ts";

export const SYNC_EVENT_TYPE = "clover.sync.import";

export type UpsertCloverRowParams = {
  businessId: string;
  details: CloverPaymentDetails;
  paymentSource: string;
  eventType?: string;
  eventDate?: string | null;
  notificationKey?: string | null;
  rawWebhook?: Record<string, unknown>;
};

export async function upsertCloverTransactionRow(
  supabase: SupabaseClient,
  params: UpsertCloverRowParams,
): Promise<{ ok: boolean; created: boolean; id?: string }> {
  const eventType = params.eventType || SYNC_EVENT_TYPE;
  const eventDate = params.eventDate ?? params.details.createdTime ?? params.details.modifiedTime ?? null;

  const row = {
    business_id: params.businessId,
    payment_id: params.details.paymentId,
    notification_key: params.notificationKey ?? null,
    event_type: eventType,
    event_date: eventDate,
    transaction_kind: params.details.transactionKind,
    amount: params.details.amount,
    result: params.details.result,
    status: params.details.status,
    order_id: params.details.orderId,
    employee_id: params.details.employeeId,
    payment_source: params.paymentSource,
    raw_webhook: params.rawWebhook ?? { source: "sync" },
    raw_details: params.details.raw,
    fetched_details_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from("clover_transactions")
    .select("id, event_type")
    .eq("business_id", params.businessId)
    .eq("payment_id", params.details.paymentId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("clover_transactions")
      .update({
        ...row,
        event_type: existing.event_type?.includes("sync") ? eventType : existing.event_type,
      })
      .eq("id", existing.id);
    if (error) {
      console.error("[clover store] update failed:", error.message);
      return { ok: false, created: false };
    }
    return { ok: true, created: false, id: existing.id as string };
  }

  const { data: inserted, error } = await supabase
    .from("clover_transactions")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[clover store] insert failed:", error.message);
    return { ok: false, created: false };
  }

  return { ok: true, created: true, id: inserted?.id as string | undefined };
}
