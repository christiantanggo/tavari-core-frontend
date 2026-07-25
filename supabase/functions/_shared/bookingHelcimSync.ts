import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { finalizePendingBooking } from "./bookingFinalization.ts";
import { getHelcimCredentialsForBusiness } from "./helcimBusinessCredentials.ts";
import {
  bookingCardOnFileInvoicePrefix,
  fetchHelcimDefaultCard,
  recordBookingHelcimCardOnFilePayment,
  reconcileBookingPaymentStatus,
  sumCompletedBookingPayments,
} from "./helcimCardOnFile.ts";
import { searchHelcimApprovedTransaction } from "./kioskHelcimFinalization.ts";

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

function isApprovedHelcimResult(value: unknown): boolean {
  const text = String(value ?? "").trim().toUpperCase();
  return text.includes("APPROVED") || text.includes("APPROVAL") || text.includes("SUCCESS");
}

function amountToNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Number(numeric) : 0;
}

async function searchHelcimTransactions(
  apiToken: string,
  payload: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const helcimResponse = await fetch("https://api.helcim.com/v2/transaction/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      "api-token": apiToken,
    },
    body: JSON.stringify(payload),
  });

  const responseText = await helcimResponse.text();
  if (!helcimResponse.ok) return [];

  let helcimData: Record<string, unknown> = {};
  try {
    helcimData = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : {};
  } catch {
    return [];
  }

  return (
    (helcimData.response as { transactions?: unknown[] } | undefined)?.transactions ??
    helcimData.transactions ??
    (helcimData.data as { transactions?: unknown[] } | undefined)?.transactions ??
    (Array.isArray(helcimData) ? helcimData : [])
  ) as Array<Record<string, unknown>>;
}

async function syncHelcimCardForCustomer(
  supabase: SupabaseClient,
  businessId: string,
  customerId: string,
  customerCode: string | null,
): Promise<boolean> {
  const code = String(customerCode || "").trim();
  if (!code || !customerId || !businessId) return false;

  await supabase
    .from("pos_loyalty_accounts")
    .update({ helcim_customer_code: code })
    .eq("id", customerId)
    .eq("business_id", businessId);

  const creds = await getHelcimCredentialsForBusiness(supabase, businessId);
  if (!creds?.apiToken) return true;

  try {
    const card = await fetchHelcimDefaultCard(code, creds.apiToken);
    return Boolean(card?.cardToken || card?.lastFour);
  } catch {
    return false;
  }
}

/** Try to recover Helcim customer/card from a completed deposit invoice. */
export async function syncBookingHelcimCardFromInvoices(
  supabase: SupabaseClient,
  businessId: string,
  bookingId: string,
): Promise<{ synced: boolean; customerCode?: string | null }> {
  const { data: booking } = await supabase
    .from("bookings")
    .select("customer_id")
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!booking?.customer_id) return { synced: false };

  const { data: rows } = await supabase
    .from("booking_pending_helcim")
    .select("invoice_number, amount, customer_id, status")
    .eq("booking_id", bookingId)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(5);

  const creds = await getHelcimCredentialsForBusiness(supabase, businessId);
  if (!creds?.apiToken) return { synced: false };

  for (const row of rows || []) {
    if (!row.invoice_number) continue;
    const hit = await searchHelcimApprovedTransaction(creds.apiToken, row.invoice_number, {
      amount: Number(row.amount),
    });
    if (!hit?.customerCode) continue;
    const hasCard = await syncHelcimCardForCustomer(
      supabase,
      businessId,
      booking.customer_id,
      hit.customerCode,
    );
    if (hasCard) return { synced: true, customerCode: hit.customerCode };
  }

  return { synced: false };
}

/** Poll Helcim for an approved BP- transaction and finalize the booking payment. */
export async function syncPendingBookingHelcimFromHelcimApi(
  supabase: SupabaseClient,
  checkoutToken: string,
): Promise<{ status: string; synced: boolean; bookingId?: string | null } | null> {
  const token = String(checkoutToken ?? "").trim();
  if (!token) return null;

  const { data: row, error } = await supabase
    .from("booking_pending_helcim")
    .select("id, status, invoice_number, business_id, amount, booking_id, created_at")
    .eq("checkout_token", token)
    .maybeSingle();

  if (error) {
    console.error("[bookingHelcimSync] load pending:", error);
    return null;
  }
  if (!row) return null;
  if (row.status === "completed") {
    return { status: "completed", synced: false, bookingId: row.booking_id ?? null };
  }

  const creds = await getHelcimCredentialsForBusiness(supabase, row.business_id);
  if (!creds?.apiToken || !row.invoice_number) {
    return { status: row.status ?? "pending", synced: false, bookingId: row.booking_id ?? null };
  }

  const hit = await searchHelcimApprovedTransaction(creds.apiToken, row.invoice_number, {
    amount: Number(row.amount),
    dateFrom: row.created_at,
    dateTo: new Date().toISOString(),
  });
  if (!hit) {
    return { status: row.status ?? "pending", synced: false, bookingId: row.booking_id ?? null };
  }

  const finalized = await finalizePendingBooking({
    supabase,
    pendingId: row.id,
    transactionId: hit.transactionId,
    amount: hit.amount || row.amount,
    approvalCode: hit.approvalCode,
    customerCode: hit.customerCode,
    recoverPaidCheckout: true,
  });

  if (!finalized.ok) {
    console.warn("[bookingHelcimSync] finalize failed:", finalized.message);
    return { status: row.status ?? "pending", synced: false, bookingId: row.booking_id ?? null };
  }

  return { status: "completed", synced: true, bookingId: finalized.bookingId };
}

/** Recover approved staff card-on-file charges that never created booking_payments rows. */
export async function syncBookingOrphanedCardOnFileCharges(
  supabase: SupabaseClient,
  businessId: string,
  bookingId: string,
): Promise<{ synced: number; reconciled: boolean }> {
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, customer_id, order_total, created_at")
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!booking?.customer_id) {
    return { synced: 0, reconciled: false };
  }

  const creds = await getHelcimCredentialsForBusiness(supabase, businessId);
  if (!creds?.apiToken) {
    return { synced: 0, reconciled: false };
  }

  const { data: loyalty } = await supabase
    .from("pos_loyalty_accounts")
    .select("helcim_customer_code")
    .eq("id", booking.customer_id)
    .eq("business_id", businessId)
    .maybeSingle();

  const customerCode = String(loyalty?.helcim_customer_code || "").trim();
  if (!customerCode) {
    return { synced: 0, reconciled: false };
  }

  const { data: existingPayments } = await supabase
    .from("booking_payments")
    .select("transaction_id")
    .eq("booking_id", bookingId);

  const knownTxnIds = new Set(
    (existingPayments || [])
      .map((row) => String(row.transaction_id || "").trim())
      .filter(Boolean),
  );

  const invoicePrefix = bookingCardOnFileInvoicePrefix(bookingId);
  const dateFrom = booking.created_at
    ? new Date(booking.created_at)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dateTo = new Date();

  const searchPayloads: Record<string, unknown>[] = [
    { customerCode, dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() },
    { invoiceNumber: invoicePrefix, dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() },
  ];

  const hits: Array<{ transactionId: string; amount: number }> = [];
  for (const payload of searchPayloads) {
    const transactions = await searchHelcimTransactions(creds.apiToken, payload);
    for (const txn of transactions) {
      const result = txn.result ?? txn.status;
      if (!isApprovedHelcimResult(result)) continue;

      const transactionId = String(txn.transactionId ?? txn.id ?? "").trim();
      if (!transactionId || knownTxnIds.has(transactionId)) continue;

      const invoiceNumber = String(
        txn.invoiceNumber ?? (txn.invoice as { number?: string } | undefined)?.number ?? "",
      ).trim();
      if (invoiceNumber && !invoiceNumber.startsWith(invoicePrefix)) continue;

      const amount = roundMoney(amountToNumber(txn.amount));
      if (amount <= 0) continue;

      hits.push({ transactionId, amount });
      knownTxnIds.add(transactionId);
    }
  }

  let synced = 0;
  let totalPaid = await sumCompletedBookingPayments(supabase, bookingId);
  const orderTotal = roundMoney(Number(booking.order_total) || 0);

  for (const hit of hits) {
    try {
      await recordBookingHelcimCardOnFilePayment(supabase, businessId, bookingId, {
        chargeAmount: hit.amount,
        orderTotal,
        existingTotalPaid: totalPaid,
        transactionId: hit.transactionId,
      });
      totalPaid = roundMoney(totalPaid + hit.amount);
      synced += 1;
    } catch (error) {
      console.warn("[bookingHelcimSync] orphan card-on-file record failed:", error);
    }
  }

  const reconciled = await reconcileBookingPaymentStatus(supabase, businessId, bookingId);
  return { synced, reconciled: reconciled.changed };
}

/** Staff/customer recovery: sync all open Helcim sessions tied to a booking. */
export async function syncBookingPendingHelcimPayments(
  supabase: SupabaseClient,
  businessId: string,
  bookingId: string,
): Promise<{
  synced: number;
  bookingId: string;
  cardSynced?: boolean;
  helcimCustomerCode?: string | null;
  cardOnFileSynced?: number;
  paymentStatusReconciled?: boolean;
}> {
  const { data: rows, error } = await supabase
    .from("booking_pending_helcim")
    .select("id, checkout_token, status")
    .eq("business_id", businessId)
    .eq("booking_id", bookingId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Could not load pending payment sessions");
  }

  let synced = 0;
  let cardSynced = false;
  for (const row of rows || []) {
    if (!row.checkout_token) continue;
    const result = await syncPendingBookingHelcimFromHelcimApi(supabase, row.checkout_token);
    if (result?.synced) synced += 1;
  }

  const cardResult = await syncBookingHelcimCardFromInvoices(supabase, businessId, bookingId);
  cardSynced = cardResult.synced;

  const orphanResult = await syncBookingOrphanedCardOnFileCharges(supabase, businessId, bookingId);
  const reconcileResult = orphanResult.synced === 0
    ? await reconcileBookingPaymentStatus(supabase, businessId, bookingId)
    : { changed: orphanResult.reconciled, paymentStatus: "", totalPaid: 0 };

  return {
    synced,
    bookingId,
    cardSynced,
    helcimCustomerCode: cardResult.customerCode ?? null,
    cardOnFileSynced: orphanResult.synced,
    paymentStatusReconciled: orphanResult.reconciled || reconcileResult.changed,
  };
}
