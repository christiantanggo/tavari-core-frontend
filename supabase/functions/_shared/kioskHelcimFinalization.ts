import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getHelcimCredentialsForBusiness } from "./helcimBusinessCredentials.ts";

type SupabaseClient = ReturnType<typeof createClient>;

const nowIso = () => new Date().toISOString();

const amountToNumber = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Number(numeric) : 0;
};

async function broadcastKioskCompletion(
  supabase: SupabaseClient,
  checkoutToken: string | null,
  invoiceNumber: string | null,
  pendingId: string,
  transactionId: string | null,
  amount: number,
  approvalCode: string | null,
) {
  const channels = new Set<string>();
  if (checkoutToken) channels.add(`helcim-payment-${checkoutToken}`);
  if (invoiceNumber) channels.add(`helcim-payment-${invoiceNumber}`);

  for (const channelName of channels) {
    try {
      await supabase.channel(channelName).send({
        type: "broadcast",
        event: "payment_completed",
        payload: {
          kioskPayment: true,
          pendingId,
          invoiceNumber,
          checkoutToken,
          transactionId,
          status: "completed",
          amount,
          approvalCode,
          timestamp: nowIso(),
        },
      });
    } catch (error) {
      console.error("[kioskHelcimFinalization] broadcast failed:", { channelName, error });
    }
  }
}

export type FinalizeKioskPendingResult =
  | { ok: true; pendingId: string; alreadyCompleted?: boolean }
  | { ok: false; status: number; message: string };

/** Completes a KK-{uuid} kiosk Helcim Pay session (invoice from webhook). */
export async function finalizeKioskPendingPayment({
  supabase,
  pendingId,
  transactionId = null,
  amount = null,
  approvalCode = null,
}: {
  supabase: SupabaseClient;
  pendingId: string;
  transactionId?: string | null;
  amount?: number | string | null;
  approvalCode?: string | null;
}): Promise<FinalizeKioskPendingResult> {
  const { data: row, error: loadErr } = await supabase
    .from("kiosk_helcim_pending")
    .select(`
      id,
      checkout_token,
      invoice_number,
      business_id,
      amount,
      currency,
      status,
      helcim_transaction_id
    `)
    .eq("id", pendingId)
    .maybeSingle();

  if (loadErr) {
    console.error("[kioskHelcimFinalization] load:", loadErr);
    return { ok: false, status: 500, message: "Failed to load kiosk session" };
  }
  if (!row) {
    return { ok: false, status: 404, message: "Kiosk session not found" };
  }

  if (row.status === "completed") {
    await broadcastKioskCompletion(
      supabase,
      row.checkout_token ?? null,
      row.invoice_number ?? null,
      row.id,
      transactionId ?? row.helcim_transaction_id ?? null,
      amountToNumber(amount ?? row.amount),
      approvalCode ? String(approvalCode) : null,
    );
    return { ok: true, pendingId: row.id, alreadyCompleted: true };
  }

  if (row.status !== "pending") {
    return { ok: false, status: 409, message: `Kiosk session is ${row.status}` };
  }

  const { data: updated, error: updErr } = await supabase
    .from("kiosk_helcim_pending")
    .update({
      status: "completed",
      updated_at: nowIso(),
      helcim_transaction_id: transactionId ? String(transactionId) : row.helcim_transaction_id ?? null,
      helcim_approval_code: approvalCode ? String(approvalCode) : null,
    })
    .eq("id", pendingId)
    .eq("status", "pending")
    .select("id, checkout_token, invoice_number, amount")
    .maybeSingle();

  if (updErr) {
    console.error("[kioskHelcimFinalization] update:", updErr);
    return { ok: false, status: 500, message: "Failed to complete kiosk session" };
  }

  if (!updated) {
    const { data: again } = await supabase
      .from("kiosk_helcim_pending")
      .select("id, status, checkout_token, invoice_number, amount, helcim_transaction_id")
      .eq("id", pendingId)
      .maybeSingle();
    if (again?.status === "completed") {
      await broadcastKioskCompletion(
        supabase,
        again.checkout_token ?? null,
        again.invoice_number ?? null,
        again.id,
        transactionId ?? again.helcim_transaction_id ?? null,
        amountToNumber(amount ?? again.amount),
        approvalCode ? String(approvalCode) : null,
      );
      return { ok: true, pendingId: again.id, alreadyCompleted: true };
    }
    return { ok: false, status: 409, message: "Kiosk session could not be claimed" };
  }

  await broadcastKioskCompletion(
    supabase,
    updated.checkout_token ?? null,
    updated.invoice_number ?? null,
    updated.id,
    transactionId ? String(transactionId) : null,
    amountToNumber(amount ?? updated.amount),
    approvalCode ? String(approvalCode) : null,
  );

  return { ok: true, pendingId: updated.id };
}

function isApprovedHelcimResult(value: unknown): boolean {
  const text = String(value ?? "").trim().toUpperCase();
  return text.includes("APPROVED") || text.includes("APPROVAL") || text.includes("SUCCESS");
}

/** Look up an approved Helcim transaction by invoice number (KK-, BP-, etc.). */
export async function searchHelcimApprovedTransaction(
  apiToken: string,
  invoiceNumber: string,
  options?: {
    amount?: number;
    dateFrom?: string | Date | null;
    dateTo?: string | Date | null;
  },
): Promise<{
  transactionId: string;
  approvalCode: string | null;
  amount: number;
  customerCode: string | null;
} | null> {
  const invoice = String(invoiceNumber ?? "").trim();
  if (!apiToken || !invoice) return null;

  const parseTransactions = (helcimData: Record<string, unknown>) => (
    (helcimData.response as { transactions?: unknown[] } | undefined)?.transactions ??
    helcimData.transactions ??
    (helcimData.data as { transactions?: unknown[] } | undefined)?.transactions ??
    (Array.isArray(helcimData) ? helcimData : [])
  ) as Array<Record<string, unknown>>;

  const pickApproved = (transactions: Array<Record<string, unknown>>, invoiceHint?: string) => {
    const normalizedHint = String(invoiceHint ?? invoice).trim();
    const pendingId = normalizedHint.startsWith("BP-") ? normalizedHint.slice(3) : normalizedHint;

    return transactions.find((t) => {
      const txInvoice = String(t.invoiceNumber ?? (t.invoice as { number?: string } | undefined)?.number ?? "").trim();
      const matchesInvoice =
        txInvoice === normalizedHint ||
        txInvoice === pendingId ||
        (txInvoice && normalizedHint.includes(txInvoice)) ||
        (txInvoice && txInvoice.includes(pendingId));
      const result = t.result ?? t.status;
      if (!isApprovedHelcimResult(result)) return false;
      if (invoiceHint == null) return matchesInvoice;
      return matchesInvoice;
    }) ?? null;
  };

  const toHit = (approved: Record<string, unknown> | null) => {
    if (!approved) return null;
    const transactionId = String(approved.transactionId ?? approved.id ?? "").trim();
    if (!transactionId) return null;
    return {
      transactionId,
      approvalCode: approved.approvalCode != null
        ? String(approved.approvalCode)
        : approved.authCode != null
        ? String(approved.authCode)
        : approved.approval != null
        ? String(approved.approval)
        : null,
      amount: amountToNumber(approved.amount),
      customerCode: String(
        approved.customerCode
        ?? approved.customer_code
        ?? (typeof approved.customer === "object" && approved.customer !== null
          ? (approved.customer as Record<string, unknown>).customerCode
            ?? (approved.customer as Record<string, unknown>).code
          : "")
        ?? "",
      ).trim() || null,
    };
  };

  const runSearch = async (payload: Record<string, unknown>, useV1 = false) => {
    const url = useV1
      ? "https://api.helcim.com/v1/transaction/search"
      : "https://api.helcim.com/v2/transaction/search";
    const body = useV1
      ? { token: apiToken, search: payload }
      : payload;

    const helcimResponse = await fetch(url, {
      method: "POST",
      headers: useV1
        ? { "Content-Type": "application/json", accept: "application/json" }
        : {
          "Content-Type": "application/json",
          accept: "application/json",
          "api-token": apiToken,
        },
      body: JSON.stringify(body),
    });

    const responseText = await helcimResponse.text();
    let helcimData: Record<string, unknown> = {};
    try {
      helcimData = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : {};
    } catch {
      return null;
    }

    if (!helcimResponse.ok) return null;
    return parseTransactions(helcimData);
  };

  let transactions = await runSearch({ invoiceNumber: invoice });
  let approved = pickApproved(transactions || []);
  let hit = toHit(approved);
  if (hit) return hit;

  transactions = await runSearch({ invoiceNumber: invoice }, true);
  approved = pickApproved(transactions || []);
  hit = toHit(approved);
  if (hit) return hit;

  const amount = options?.amount;
  if (amount != null && Number.isFinite(amount) && amount > 0) {
    const dateFrom = options?.dateFrom
      ? new Date(options.dateFrom)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dateTo = options?.dateTo ? new Date(options.dateTo) : new Date();
    const amountPayload = {
      amount: Number(amount).toFixed(2),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    };

    transactions = await runSearch(amountPayload);
    approved = (transactions || []).find((t) => {
      const result = t.result ?? t.status;
      if (!isApprovedHelcimResult(result)) return false;
      const txAmount = amountToNumber(t.amount);
      return Math.abs(txAmount - amount) < 0.011;
    }) ?? null;
    hit = toHit(approved);
    if (hit) return hit;
  }

  return null;
}

/**
 * QR checkout pays on the customer's phone — webhook may lag or be missing.
 * Poll Helcim directly and finalize KK- sessions when approved.
 */
export async function syncPendingKioskHelcimFromHelcimApi(
  supabase: SupabaseClient,
  checkoutToken: string,
): Promise<{ status: string; synced: boolean } | null> {
  const token = String(checkoutToken ?? "").trim();
  if (!token) return null;

  const { data: row, error } = await supabase
    .from("kiosk_helcim_pending")
    .select("id, status, invoice_number, business_id, amount")
    .eq("checkout_token", token)
    .maybeSingle();

  if (error) {
    console.error("[kioskHelcimFinalization] sync load:", error);
    return null;
  }
  if (!row) return null;
  if (row.status === "completed") return { status: "completed", synced: false };

  const creds = await getHelcimCredentialsForBusiness(supabase, row.business_id);
  if (!creds?.apiToken) {
    return { status: row.status ?? "pending", synced: false };
  }

  const hit = await searchHelcimApprovedTransaction(creds.apiToken, row.invoice_number);
  if (!hit) {
    return { status: row.status ?? "pending", synced: false };
  }

  const finalized = await finalizeKioskPendingPayment({
    supabase,
    pendingId: row.id,
    transactionId: hit.transactionId,
    amount: hit.amount || row.amount,
    approvalCode: hit.approvalCode,
  });

  if (!finalized.ok) {
    console.warn("[kioskHelcimFinalization] sync finalize failed:", finalized.message);
    return { status: row.status ?? "pending", synced: false };
  }

  return { status: "completed", synced: true };
}
