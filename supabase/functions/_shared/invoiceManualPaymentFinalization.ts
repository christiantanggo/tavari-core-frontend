import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  alignPosSaleToPaymentDate,
  syncPaidInvoiceToErpNext,
} from "./invoiceErpNextSync.ts";

const nowIso = () => new Date().toISOString();

export type ManualPaymentResult =
  | { ok: true; invoiceId: string; alreadyPaid?: boolean }
  | { ok: false; message: string };

/**
 * Mark an invoice paid via e-transfer / manual confirmation (same outcome as card payment).
 */
export async function finalizeInvoiceManualPayment(
  supabase: SupabaseClient,
  invoiceId: string,
  {
    paymentMethod = "e_transfer",
    referenceNumber = null,
    confirmedVia = "etransfer_confirm",
  }: {
    paymentMethod?: string;
    referenceNumber?: string | null;
    confirmedVia?: string;
  } = {},
): Promise<ManualPaymentResult> {
  const { data: invoice, error } = await supabase
    .from("tavari_invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();

  if (error || !invoice) {
    return { ok: false, message: "Invoice not found" };
  }

  if (invoice.status === "paid" || Number(invoice.balance_due) <= 0.01) {
    return { ok: true, invoiceId: invoice.id, alreadyPaid: true };
  }

  if (["void", "refunded"].includes(String(invoice.status))) {
    return { ok: false, message: `Invoice is ${invoice.status}` };
  }

  const paidAmount = Number(invoice.total) || Number(invoice.balance_due) || 0;
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
        payment_method: paymentMethod,
        sale_number: invoice.invoice_number,
        notes: `Invoice payment ${invoice.invoice_number} (${confirmedVia})`,
        item_count: 0,
        is_paid: true,
      })
      .select("id")
      .single();

    if (saleError) {
      return { ok: false, message: "Failed to create sale record" };
    }
    posSaleId = sale.id;
  } else {
    await alignPosSaleToPaymentDate(supabase, posSaleId, invoice.business_id);
    await supabase
      .from("pos_sales")
      .update({
        payment_method: paymentMethod,
        is_paid: true,
        updated_at: nowIso(),
      })
      .eq("id", posSaleId);
  }

  await supabase.from("pos_payments").insert({
    business_id: invoice.business_id,
    sale_id: posSaleId,
    payment_method: paymentMethod,
    amount: paidAmount,
    reference_number: referenceNumber,
    custom_method_name: paymentMethod === "e_transfer" ? "E-Transfer" : null,
    notes: JSON.stringify({ confirmed_via: confirmedVia }),
  });

  await supabase
    .from("tavari_invoices")
    .update({
      status: "paid",
      balance_due: 0,
      pos_sale_id: posSaleId,
      etransfer_confirmed_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq("id", invoice.id);

  try {
    await syncPaidInvoiceToErpNext(supabase, invoice.id);
  } catch (erpErr) {
    console.warn("[invoiceManualPaymentFinalization] ERPNext sync failed:", erpErr);
  }

  return { ok: true, invoiceId: invoice.id };
}
