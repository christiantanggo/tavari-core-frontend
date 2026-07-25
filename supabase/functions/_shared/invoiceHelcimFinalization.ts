import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  alignPosSaleToPaymentDate,
  syncPaidInvoiceToErpNext,
} from "./invoiceErpNextSync.ts";

type FinalizeArgs = {
  supabase: SupabaseClient;
  pendingId: string;
  transactionId?: string | null;
  amount?: number | string | null;
  approvalCode?: string | null;
};

type FinalizeResult =
  | { ok: true; invoiceId: string; alreadyCompleted?: boolean }
  | { ok: false; status: number; message: string };

const nowIso = () => new Date().toISOString();

const amountToNumber = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Number(numeric) : 0;
};

async function broadcastInvoicePayment(
  supabase: SupabaseClient,
  invoiceNumber: string | null,
  checkoutToken: string | null,
  invoiceId: string,
  payToken: string | null,
) {
  const channels = new Set<string>();
  if (invoiceNumber) channels.add(`helcim-payment-${invoiceNumber}`);
  if (checkoutToken) channels.add(`helcim-payment-${checkoutToken}`);
  if (payToken) channels.add(`invoice-pay-${payToken}`);

  for (const channelName of channels) {
    try {
      await supabase.channel(channelName).send({
        type: "broadcast",
        event: "payment_completed",
        payload: { invoiceId, invoiceNumber },
      });
    } catch (e) {
      console.warn("[invoiceHelcimFinalization] broadcast failed:", channelName, e);
    }
  }
}

export async function finalizePendingInvoice({
  supabase,
  pendingId,
  transactionId = null,
  amount = null,
  approvalCode = null,
}: FinalizeArgs): Promise<FinalizeResult> {
  const { data: pending, error: pendingError } = await supabase
    .from("invoice_pending_helcim")
    .select("*")
    .eq("id", pendingId)
    .maybeSingle();

  if (pendingError) {
    console.error("[invoiceHelcimFinalization] load pending:", pendingError);
    return { ok: false, status: 500, message: "Failed to load pending invoice payment" };
  }
  if (!pending) {
    return { ok: false, status: 404, message: "Pending invoice payment not found" };
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("tavari_invoices")
    .select("*")
    .eq("id", pending.invoice_id)
    .maybeSingle();

  if (invoiceError || !invoice) {
    return { ok: false, status: 404, message: "Invoice not found" };
  }

  if (pending.status === "completed") {
    await broadcastInvoicePayment(
      supabase,
      pending.invoice_number,
      pending.checkout_token,
      invoice.id,
      invoice.pay_token,
    );
    return { ok: true, invoiceId: invoice.id, alreadyCompleted: true };
  }

  if (pending.status !== "pending") {
    return { ok: false, status: 409, message: `Pending payment is ${pending.status}` };
  }

  const { data: claimed, error: claimError } = await supabase
    .from("invoice_pending_helcim")
    .update({
      status: "processing",
      updated_at: nowIso(),
      helcim_transaction_id: transactionId ? String(transactionId) : null,
      helcim_approval_code: approvalCode ? String(approvalCode) : null,
    })
    .eq("id", pending.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (claimError || !claimed) {
    return { ok: false, status: 409, message: "Payment already processing" };
  }

  const paidAmount = amountToNumber(amount ?? pending.amount ?? invoice.balance_due);

  let posSaleId = invoice.pos_sale_id as string | null;
  if (!posSaleId) {
    const { data: sale, error: saleError } = await supabase
      .from("pos_sales")
      .insert({
        business_id: invoice.business_id,
        customer_name: invoice.recipient_name,
        customer_email: invoice.recipient_email,
        customer_phone: invoice.recipient_phone,
        loyalty_customer_id: invoice.loyalty_customer_id,
        subtotal: invoice.subtotal,
        tax: invoice.tax_amount,
        discount: 0,
        total: invoice.total,
        payment_status: "completed",
        payment_method: "helcim_hosted",
        sale_number: invoice.invoice_number,
        notes: `Invoice payment ${invoice.invoice_number}`,
        item_count: 0,
        helcim_transaction_id: transactionId ? String(transactionId) : null,
        helcim_approval_code: approvalCode ? String(approvalCode) : null,
        is_paid: true,
      })
      .select("id")
      .single();

    if (saleError) {
      await supabase
        .from("invoice_pending_helcim")
        .update({ status: "failed", updated_at: nowIso() })
        .eq("id", pending.id);
      return { ok: false, status: 500, message: "Failed to create sale record" };
    }
    posSaleId = sale.id;
  } else {
    await alignPosSaleToPaymentDate(supabase, posSaleId, invoice.business_id);
    await supabase
      .from("pos_sales")
      .update({
        payment_method: "helcim_hosted",
        is_paid: true,
        helcim_transaction_id: transactionId ? String(transactionId) : null,
        helcim_approval_code: approvalCode ? String(approvalCode) : null,
      })
      .eq("id", posSaleId);
  }

  await supabase.from("pos_payments").insert({
    business_id: invoice.business_id,
    sale_id: posSaleId,
    payment_method: "helcim_terminal",
    amount: paidAmount,
    reference_number: transactionId ? String(transactionId) : null,
    notes: approvalCode ? JSON.stringify({ helcim: { approvalCode } }) : null,
  });

  await supabase
    .from("tavari_invoices")
    .update({
      status: "paid",
      balance_due: 0,
      pos_sale_id: posSaleId,
      updated_at: nowIso(),
    })
    .eq("id", invoice.id);

  await supabase
    .from("invoice_pending_helcim")
    .update({ status: "completed", updated_at: nowIso() })
    .eq("id", pending.id);

  await broadcastInvoicePayment(
    supabase,
    pending.invoice_number,
    pending.checkout_token,
    invoice.id,
    invoice.pay_token,
  );

  try {
    await syncPaidInvoiceToErpNext(supabase, invoice.id);
  } catch (erpErr) {
    console.warn("[invoiceHelcimFinalization] ERPNext sync failed:", erpErr);
  }

  return { ok: true, invoiceId: invoice.id };
}
