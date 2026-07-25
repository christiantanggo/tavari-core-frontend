import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getHelcimCredentialsForBusiness } from "./helcimBusinessCredentials.ts";

export interface HelcimDefaultCard {
  customerCode: string;
  cardId: number | string | null;
  cardToken: string | null;
  cardType: string | null;
  cardHolderName: string | null;
  cardExpiry: string | null;
  lastFour: string | null;
  maskedCard: string | null;
}

export interface HelcimPurchaseResult {
  transactionId: string | null;
  approvalCode: string | null;
  amount: number;
  customerCode: string | null;
  invoiceNumber: string | null;
  raw: Record<string, unknown>;
}

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

function normalizeCustomersPayload(payload: unknown): Record<string, unknown>[] {
  const p = payload as Record<string, unknown>;
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (Array.isArray(p?.customers)) return p.customers as Record<string, unknown>[];
  if (Array.isArray(p?.data)) return p.data as Record<string, unknown>[];
  return payload ? [p] : [];
}

export async function fetchHelcimDefaultCard(
  customerCode: string,
  helcimApiToken: string,
): Promise<HelcimDefaultCard | null> {
  const response = await fetch(
    `https://api.helcim.com/v2/customers?customerCode=${encodeURIComponent(customerCode)}&includeCards=yes&limit=1`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        "api-token": helcimApiToken,
      },
    },
  );

  const payload = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    const err = payload as Record<string, unknown>;
    throw new Error(String(err?.message || err?.error || "Failed to fetch Helcim customer cards"));
  }

  const customer = normalizeCustomersPayload(payload)[0] || null;
  const cards = Array.isArray(customer?.cards) ? customer.cards as Record<string, unknown>[] : [];
  const defaultCard =
    cards.find((card) => card?.isDefault === true || card?.default === true || card?.is_default === true)
    || cards[0]
    || null;

  if (!defaultCard) return null;

  const cardNumberMask = String(defaultCard.cardF6L4 || defaultCard.cardNumber || "");
  const lastFour = cardNumberMask ? cardNumberMask.slice(-4) : null;
  const cardToken = String(
    defaultCard.cardToken || defaultCard.card_token || defaultCard.token || "",
  ).trim() || null;

  return {
    customerCode,
    cardId: (defaultCard.id as number | string | null) ?? null,
    cardToken,
    cardType: String(defaultCard.cardType || defaultCard.brand || "").trim() || null,
    cardHolderName: String(defaultCard.cardHolderName || "").trim() || null,
    cardExpiry: String(defaultCard.cardExpiry || "").trim() || null,
    lastFour,
    maskedCard: lastFour ? `****${lastFour}` : null,
  };
}

export async function resolveHelcimDefaultCardForCustomer(
  supabase: SupabaseClient,
  businessId: string,
  customerId: string,
): Promise<{ customerCode: string | null; defaultCard: HelcimDefaultCard | null }> {
  const { data: loyalty, error } = await supabase
    .from("pos_loyalty_accounts")
    .select("id, helcim_customer_code")
    .eq("id", customerId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (error || !loyalty) {
    throw new Error("Customer account not found");
  }

  const customerCode = String(loyalty.helcim_customer_code || "").trim() || null;
  if (!customerCode) {
    return { customerCode: null, defaultCard: null };
  }

  const helcimCreds = await getHelcimCredentialsForBusiness(supabase, businessId);
  const helcimApiToken = helcimCreds?.apiToken ?? null;
  if (!helcimApiToken) {
    return { customerCode, defaultCard: null };
  }

  const defaultCard = await fetchHelcimDefaultCard(customerCode, helcimApiToken);
  return { customerCode, defaultCard };
}

export async function chargeHelcimCardOnFile(input: {
  helcimApiToken: string;
  customerCode: string;
  cardToken: string;
  cardId?: number | string | null;
  amount: number;
  currency?: string;
  ipAddress: string;
  invoiceNumber?: string;
  invoiceDescription?: string;
  idempotencyKey: string;
}): Promise<HelcimPurchaseResult> {
  const amount = roundMoney(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid charge amount");
  }

  const body: Record<string, unknown> = {
    ipAddress: input.ipAddress,
    ecommerce: true,
    currency: input.currency || "CAD",
    amount,
    customerCode: input.customerCode,
    cardData: input.cardToken
      ? { cardToken: input.cardToken }
      : input.cardId != null
      ? { id: input.cardId }
      : null,
  };

  if (!body.cardData) {
    throw new Error("Missing card token or card id for card-on-file charge");
  }

  // Top-level invoiceNumber only links an invoice that already exists in Helcim.
  // For staff card-on-file charges, create a new invoice with the purchase instead.
  if (input.invoiceNumber) {
    body.invoice = {
      invoiceNumber: input.invoiceNumber,
      lineItems: [
        {
          description: input.invoiceDescription || "Booking payment",
          quantity: 1,
          price: amount,
          total: amount,
        },
      ],
    };
  }

  const response = await fetch("https://api.helcim.com/v2/payment/purchase", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-token": input.helcimApiToken,
      "idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify(body),
  });

  const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const errors = Array.isArray(raw?.errors) ? raw.errors : [];
    const firstErr = errors[0] as Record<string, unknown> | undefined;
    const detail = String(
      firstErr?.message || raw?.message || raw?.error || "Helcim payment declined",
    );
    const err = new Error(detail) as Error & { helcimRaw?: Record<string, unknown> };
    err.helcimRaw = raw;
    throw err;
  }

  const transaction = (raw?.transaction && typeof raw.transaction === "object"
    ? raw.transaction
    : raw) as Record<string, unknown>;

  return {
    transactionId: transaction?.transactionId != null
      ? String(transaction.transactionId)
      : transaction?.id != null
        ? String(transaction.id)
        : null,
    approvalCode: transaction?.approvalCode != null ? String(transaction.approvalCode) : null,
    amount,
    customerCode: transaction?.customerCode != null ? String(transaction.customerCode) : input.customerCode,
    invoiceNumber: transaction?.invoiceNumber != null ? String(transaction.invoiceNumber) : input.invoiceNumber || null,
    raw,
  };
}

export async function sumCompletedBookingPayments(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<number> {
  const { data } = await supabase
    .from("booking_payments")
    .select("amount_paid, status")
    .eq("booking_id", bookingId);

  return (data || [])
    .filter((row) => row.status === "completed")
    .reduce((sum, row) => sum + (Number(row.amount_paid) || 0), 0);
}

export function bookingCardOnFileInvoicePrefix(bookingId: string): string {
  return `BC${String(bookingId || "").replace(/-/g, "").slice(0, 12)}`;
}

export function deriveBookingPaymentStatus(
  orderTotal: number,
  totalPaid: number,
): "unpaid" | "partial" | "paid" {
  const paid = roundMoney(totalPaid);
  const total = roundMoney(orderTotal);
  if (paid <= 0) return "unpaid";
  if (total <= 0 || paid >= total - 0.005) return "paid";
  return "partial";
}

/** Keep bookings.payment_status aligned with completed booking_payments rows. */
export async function reconcileBookingPaymentStatus(
  supabase: SupabaseClient,
  businessId: string,
  bookingId: string,
): Promise<{ paymentStatus: string; totalPaid: number; changed: boolean }> {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("order_total, payment_status")
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .single();

  if (error || !booking) {
    throw new Error("Booking not found");
  }

  const totalPaid = await sumCompletedBookingPayments(supabase, bookingId);
  const orderTotal = roundMoney(Number(booking.order_total) || 0);
  const paymentStatus = deriveBookingPaymentStatus(orderTotal, totalPaid);
  const changed = booking.payment_status !== paymentStatus;

  if (changed) {
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        payment_status: paymentStatus,
        ...(paymentStatus === "paid" ? { active_payment_request_id: null } : {}),
        updated_at: now,
      })
      .eq("id", bookingId)
      .eq("business_id", businessId);

    if (updateError) {
      console.error("[helcimCardOnFile] reconcile payment_status failed:", updateError);
      throw new Error("Failed to update booking payment status");
    }
  }

  return { paymentStatus, totalPaid, changed };
}

export async function recordBookingHelcimCardOnFilePayment(
  supabase: SupabaseClient,
  businessId: string,
  bookingId: string,
  {
    chargeAmount,
    orderTotal,
    existingTotalPaid,
    transactionId,
    idempotencyFallback,
  }: {
    chargeAmount: number;
    orderTotal: number;
    existingTotalPaid: number;
    transactionId: string | null;
    idempotencyFallback?: string;
  },
): Promise<{
  paymentId: string;
  paymentStatus: string;
  remainingBalance: number;
  alreadyRecorded?: boolean;
}> {
  const amount = roundMoney(chargeAmount);
  const txnRef = String(transactionId || idempotencyFallback || "").trim();

  if (txnRef) {
    const { data: existing } = await supabase
      .from("booking_payments")
      .select("id")
      .eq("booking_id", bookingId)
      .eq("transaction_id", txnRef)
      .maybeSingle();

    if (existing?.id) {
      const reconciled = await reconcileBookingPaymentStatus(supabase, businessId, bookingId);
      const remainingBalance = roundMoney(Math.max(0, roundMoney(orderTotal) - reconciled.totalPaid));
      return {
        paymentId: existing.id,
        paymentStatus: reconciled.paymentStatus,
        remainingBalance,
        alreadyRecorded: true,
      };
    }
  }

  const newTotalPaid = roundMoney(existingTotalPaid + amount);
  const total = roundMoney(orderTotal);
  const paymentStatus = deriveBookingPaymentStatus(total, newTotalPaid);
  const remainingBalance = roundMoney(Math.max(0, total - newTotalPaid));
  const isDeposit = paymentStatus === "partial";
  const now = new Date().toISOString();

  const { data: paymentRow, error: paymentError } = await supabase
    .from("booking_payments")
    .insert({
      booking_id: bookingId,
      payment_type: isDeposit ? "deposit" : "full",
      amount_paid: amount,
      deposit_amount: isDeposit ? amount : null,
      remaining_balance: isDeposit ? remainingBalance : null,
      payment_method: "helcim_card_on_file",
      transaction_id: txnRef || null,
      status: "completed",
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (paymentError) {
    console.error("[helcimCardOnFile] payment insert failed:", paymentError);
    throw new Error("Failed to record booking payment");
  }

  const { error: bookingUpdateError } = await supabase
    .from("bookings")
    .update({
      payment_status: paymentStatus,
      ...(paymentStatus === "paid" ? { active_payment_request_id: null } : {}),
      updated_at: now,
    })
    .eq("id", bookingId)
    .eq("business_id", businessId);

  if (bookingUpdateError) {
    console.error("[helcimCardOnFile] booking payment_status update failed:", bookingUpdateError);
    throw new Error("Payment recorded but booking status could not be updated");
  }

  if (paymentStatus === "paid") {
    await supabase
      .from("booking_payment_requests")
      .update({ status: "paid", updated_at: now })
      .eq("booking_id", bookingId)
      .eq("status", "pending");
  }

  return {
    paymentId: paymentRow.id,
    paymentStatus,
    remainingBalance,
  };
}
