/**
 * Sync a paid Tavari invoice to ERPNext (Sales Invoice + optional Payment Entry).
 * Used after Helcim/manual payment finalization.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createErpNextDoc,
  ensureCustomerInErpNext,
  fetchAccountNamesForCompany,
  fetchCompanyAbbreviation,
  fetchErpNextDoc,
  resolveLedgerAccount,
  submitErpNextDoc,
} from "./erpnext.ts";

function safeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asMoney(value: unknown) {
  const amount = Number(value);
  if (Number.isNaN(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
}

function numericValue(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

async function loadErpForBusiness(supabase: SupabaseClient, businessId: string) {
  const { data: config, error } = await supabase
    .from("accounting_business_config")
    .select(
      "erpnext_api_url, erpnext_company_name, erpnext_company_abbr, erpnext_api_key, erpnext_secret, default_bank_account_erpnext, pos_revenue_account_erpnext",
    )
    .eq("business_id", businessId)
    .maybeSingle();

  if (error || !config) return { ok: false as const, error: "Accounting config not found" };

  const baseUrl = safeText(config.erpnext_api_url).replace(/\/$/, "");
  const apiKey = safeText(config.erpnext_api_key);
  const apiSecret = safeText(config.erpnext_secret);
  if (!baseUrl || !apiKey) {
    return { ok: false as const, error: "ERPNext is not configured for this business" };
  }

  let company = safeText(config.erpnext_company_name) || "Company";
  let abbr = safeText(config.erpnext_company_abbr);
  if (!abbr) {
    const fetched = await fetchCompanyAbbreviation(baseUrl, apiKey, apiSecret, company === "Company" ? undefined : company);
    if (!fetched.ok || !fetched.abbreviation) {
      return { ok: false as const, error: fetched.error || "Could not resolve ERPNext company abbreviation" };
    }
    abbr = fetched.abbreviation;
    company = fetched.companyName || company;
  }

  const accountsRes = await fetchAccountNamesForCompany(baseUrl, apiKey, apiSecret, company);
  if (!accountsRes.ok || !accountsRes.accounts?.length) {
    return { ok: false as const, error: accountsRes.error || "Could not load ERPNext accounts" };
  }

  return {
    ok: true as const,
    config,
    baseUrl,
    apiKey,
    apiSecret,
    company,
    abbr,
    accounts: accountsRes.accounts,
  };
}

export type SyncInvoiceErpResult =
  | { ok: true; salesInvoiceName: string; paymentEntryName?: string; skipped?: boolean }
  | { ok: false; error: string };

async function buildSalesInvoiceItems(
  invoice: Record<string, unknown>,
  incomeAccount: string,
) {
  const lines = (invoice.tavari_invoice_line_items || []) as Array<Record<string, unknown>>;
  const items = lines.length > 0
    ? lines.map((line) => {
        const qty = numericValue(line.quantity) || 1;
        const rate = asMoney(line.unit_price) ?? asMoney(line.total_price) ?? 0;
        const amount = asMoney(line.total_price) ?? (rate ? Math.round(qty * rate * 100) / 100 : 0);
        const name = safeText(line.name) || "Invoice line";
        return {
          item_name: name.slice(0, 140),
          description: safeText(line.description) || name,
          qty,
          rate: rate || amount,
          amount: amount || rate,
          income_account: incomeAccount,
        };
      }).filter((row) => row.amount > 0)
    : [{
        item_name: `Invoice ${invoice.invoice_number}`.slice(0, 140),
        description: `Tavari invoice ${invoice.invoice_number}`,
        qty: 1,
        rate: asMoney(invoice.total) || 0,
        amount: asMoney(invoice.total) || 0,
        income_account: incomeAccount,
      }];
  return items;
}


/**
 * Create/submit ERPNext Sales Invoice for an open (unpaid) Tavari invoice.
 */
export async function syncOpenInvoiceToErpNext(
  supabase: SupabaseClient,
  invoiceId: string,
  businessId?: string,
): Promise<SyncInvoiceErpResult> {
  const { data: invoice, error: invoiceError } = await supabase
    .from("tavari_invoices")
    .select(`
      *,
      tavari_invoice_line_items ( name, description, quantity, unit_price, total_price, tax_amount )
    `)
    .eq("id", invoiceId)
    .maybeSingle();

  if (invoiceError || !invoice) return { ok: false, error: "Invoice not found" };
  if (businessId && invoice.business_id !== businessId) {
    return { ok: false, error: "Invoice does not belong to this business" };
  }
  if (invoice.status === "void" || invoice.status === "draft" || invoice.status === "refunded") {
    return { ok: false, error: `Cannot post invoice with status "${invoice.status}"` };
  }
  if (Number(invoice.balance_due) <= 0.01 && invoice.status === "paid") {
    return { ok: false, error: "Invoice is already paid; use payment sync instead" };
  }
  if (invoice.erpnext_sales_invoice_name) {
    return { ok: true, salesInvoiceName: invoice.erpnext_sales_invoice_name, skipped: true };
  }

  const erp = await loadErpForBusiness(supabase, invoice.business_id);
  if (!erp.ok) return { ok: false, error: erp.error };

  const suffix = ` - ${erp.abbr}`;
  const customerName = safeText(invoice.recipient_company) || safeText(invoice.recipient_name) || "Customer";
  const customerRes = await ensureCustomerInErpNext(erp.baseUrl, erp.apiKey, erp.apiSecret, customerName);
  if (!customerRes.ok || !customerRes.partyName) {
    return { ok: false, error: customerRes.error || "Could not create ERPNext customer" };
  }

  const defaultRevenue = safeText(erp.config?.pos_revenue_account_erpnext) || "Sales";
  const incomeAccountInput = defaultRevenue + suffix;
  const incomeAccount = resolveLedgerAccount(erp.accounts, incomeAccountInput);
  if (!incomeAccount) {
    return { ok: false, error: `Could not resolve income account "${incomeAccountInput}"` };
  }

  const postingDate = safeText(invoice.created_at)?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const dueDate = safeText(invoice.due_date) || postingDate;
  const items = await buildSalesInvoiceItems(invoice, incomeAccount);

  if (!items.length || items.every((i) => !i.amount)) {
    return { ok: false, error: "Invoice has no billable amount" };
  }

  const createRes = await createErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, "Sales Invoice", {
    customer: customerRes.partyName,
    company: erp.company,
    posting_date: postingDate,
    due_date: dueDate,
    update_stock: 0,
    remarks: `Tavari invoice ${invoice.invoice_number}`,
    items,
  });

  if (!createRes.ok || !createRes.name) {
    return { ok: false, error: createRes.error || "Failed to create ERPNext Sales Invoice" };
  }

  const docRes = await fetchErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, "Sales Invoice", createRes.name);
  if (!docRes.ok || !docRes.data) {
    return { ok: false, error: docRes.error || "Created Sales Invoice but could not load for submit" };
  }

  const submitRes = await submitErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, docRes.data);
  if (!submitRes.ok) {
    return { ok: false, error: submitRes.error || "Failed to submit ERPNext Sales Invoice" };
  }

  await supabase
    .from("tavari_invoices")
    .update({
      erpnext_sales_invoice_name: createRes.name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  return { ok: true, salesInvoiceName: createRes.name };
}

/**
 * Create/submit ERPNext Sales Invoice for a paid Tavari invoice and record payment if fully paid.
 */
export async function syncPaidInvoiceToErpNext(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<SyncInvoiceErpResult> {
  const { data: invoice, error: invoiceError } = await supabase
    .from("tavari_invoices")
    .select(`
      *,
      tavari_invoice_line_items ( name, description, quantity, unit_price, total_price, tax_amount )
    `)
    .eq("id", invoiceId)
    .maybeSingle();

  if (invoiceError || !invoice) return { ok: false, error: "Invoice not found" };
  if (invoice.status !== "paid" && Number(invoice.balance_due) > 0.01) {
    return { ok: false, error: "Invoice is not fully paid" };
  }
  if (invoice.erpnext_sales_invoice_name) {
    return { ok: true, salesInvoiceName: invoice.erpnext_sales_invoice_name, skipped: true };
  }

  const erp = await loadErpForBusiness(supabase, invoice.business_id);
  if (!erp.ok) return { ok: false, error: erp.error };

  const suffix = ` - ${erp.abbr}`;
  const customerName = safeText(invoice.recipient_company) || safeText(invoice.recipient_name) || "Customer";
  const customerRes = await ensureCustomerInErpNext(erp.baseUrl, erp.apiKey, erp.apiSecret, customerName);
  if (!customerRes.ok || !customerRes.partyName) {
    return { ok: false, error: customerRes.error || "Could not create ERPNext customer" };
  }

  const defaultRevenue = safeText(erp.config?.pos_revenue_account_erpnext) || "Sales";
  const incomeAccountInput = defaultRevenue + suffix;
  const incomeAccount = resolveLedgerAccount(erp.accounts, incomeAccountInput);
  if (!incomeAccount) {
    return { ok: false, error: `Could not resolve income account "${incomeAccountInput}"` };
  }

  const postingDate = new Date().toISOString().slice(0, 10);
  const dueDate = safeText(invoice.due_date) || postingDate;
  const items = await buildSalesInvoiceItems(invoice, incomeAccount);

  if (!items.length || items.every((i) => !i.amount)) {
    return { ok: false, error: "Invoice has no billable amount" };
  }

  const createRes = await createErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, "Sales Invoice", {
    customer: customerRes.partyName,
    company: erp.company,
    posting_date: postingDate,
    due_date: dueDate,
    update_stock: 0,
    remarks: `Tavari invoice ${invoice.invoice_number}`,
    items,
  });

  if (!createRes.ok || !createRes.name) {
    return { ok: false, error: createRes.error || "Failed to create ERPNext Sales Invoice" };
  }

  const docRes = await fetchErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, "Sales Invoice", createRes.name);
  if (!docRes.ok || !docRes.data) {
    return { ok: false, error: docRes.error || "Created Sales Invoice but could not load for submit" };
  }

  const submitRes = await submitErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, docRes.data);
  if (!submitRes.ok) {
    return { ok: false, error: submitRes.error || "Failed to submit ERPNext Sales Invoice" };
  }

  let paymentEntryName: string | undefined;

  const paidAmount = asMoney(invoice.total);
  if (paidAmount) {
    const bankLogical = safeText(erp.config?.default_bank_account_erpnext) || "Bank";
    const bankAccount = resolveLedgerAccount(erp.accounts, bankLogical + suffix, [`Bank${suffix}`, `Cash${suffix}`]);
    const receivableAccount = resolveLedgerAccount(erp.accounts, `Debtors${suffix}`);

    if (bankAccount && receivableAccount) {
      const invoiceRes = await fetchErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, "Sales Invoice", createRes.name);
      const outstanding = invoiceRes.ok && invoiceRes.data
        ? Math.round(numericValue(invoiceRes.data.outstanding_amount) * 100) / 100
        : paidAmount;
      const paymentAmount = Math.min(paidAmount, outstanding > 0 ? outstanding : paidAmount);

      if (paymentAmount > 0) {
        const payRes = await createErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, "Payment Entry", {
          payment_type: "Receive",
          company: erp.company,
          posting_date: postingDate,
          party_type: "Customer",
          party: customerRes.partyName,
          paid_from: receivableAccount,
          paid_to: bankAccount,
          paid_amount: paymentAmount,
          received_amount: paymentAmount,
          references: [{
            reference_doctype: "Sales Invoice",
            reference_name: createRes.name,
            allocated_amount: paymentAmount,
            outstanding_amount: outstanding,
            total_amount: paidAmount,
            due_date: dueDate,
          }],
          remarks: `Payment for Tavari invoice ${invoice.invoice_number}`,
        });

        if (payRes.ok && payRes.name) {
          const payDoc = await fetchErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, "Payment Entry", payRes.name);
          if (payDoc.ok && payDoc.data) {
            const paySubmit = await submitErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, payDoc.data);
            if (paySubmit.ok) paymentEntryName = payRes.name;
          }
        }
      }
    }
  }

  await supabase
    .from("tavari_invoices")
    .update({
      erpnext_sales_invoice_name: createRes.name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  return { ok: true, salesInvoiceName: createRes.name, paymentEntryName };
}

/** Move pos_sale into the payment-day batch window (invoice sent earlier, paid later). */
export async function alignPosSaleToPaymentDate(
  supabase: SupabaseClient,
  posSaleId: string,
  businessId: string,
) {
  if (!posSaleId) return;
  const paidAt = new Date().toISOString();
  await supabase
    .from("pos_sales")
    .update({
      payment_status: "completed",
      created_at: paidAt,
      updated_at: paidAt,
    })
    .eq("id", posSaleId)
    .eq("business_id", businessId);
}
