// One-off audit: compare posted Tavari drafts to ERPNext Purchase Invoices.
// POST { business_id, from_date?, to_date? } — service role only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { appendCompanySuffix, fetchErpNextDoc, sumGlEntryNetDebitsForAccount } from "../_shared/erpnext.ts";
import { sumPostedExpenseRecoverableItc } from "../_shared/gst34Worksheet.ts";
import { reconcileDraftExpenseAmountsForPosting, resolveDraftPostingAmounts } from "../_shared/invoiceTextFallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!token || token !== serviceKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { business_id?: string; from_date?: string; to_date?: string };
    const businessId = body.business_id;
    if (!businessId) {
      return new Response(JSON.stringify({ error: "business_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    const { data: config } = await supabase
      .from("accounting_business_config")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle();
    if (!config) {
      return new Response(JSON.stringify({ error: "Config not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const baseUrl = String(config.erpnext_api_url || "").replace(/\/$/, "");
    const apiKey = String(config.erpnext_api_key || "").trim();
    const apiSecret = String(config.erpnext_secret || "").trim();
    const abbr = String(config.erpnext_company_abbr || "").trim();

    let query = supabase
      .from("accounting_draft_expenses")
      .select("id, vendor_name_display, subtotal, tax_amount, total_amount, hst_treatment, document_type, invoice_currency, cad_settlement_total, gl_account_erpnext, is_fixed_asset, asset_gl_account_erpnext, erpnext_purchase_invoice_id, fixed_asset_id, invoice_number, transaction_date")
      .eq("business_id", businessId)
      .eq("status", "posted")
      .order("transaction_date");
    if (body.from_date) query = query.gte("transaction_date", body.from_date);
    if (body.to_date) query = query.lte("transaction_date", body.to_date);
    const { data: drafts, error } = await query;
    if (error) throw error;

    const issues: Array<Record<string, unknown>> = [];
    const rows: Array<Record<string, unknown>> = [];
    const expenseRowsForItc: Array<{ tax_amount?: unknown; hst_treatment?: unknown; document_type?: unknown }> = [];
    let tavariExpenseSubtotal = 0;

    for (const d of drafts || []) {
      const reconciled = resolveDraftPostingAmounts({
        subtotal: d.subtotal,
        tax_amount: d.tax_amount,
        total_amount: d.total_amount,
        hst_treatment: d.hst_treatment,
        invoice_currency: d.invoice_currency,
        cad_settlement_total: d.cad_settlement_total,
      });
      const treatment = reconciled.usedCadSettlement ? "exempt" : String(d.hst_treatment || "").toLowerCase();
      expenseRowsForItc.push({
        tax_amount: reconciled.usedCadSettlement ? 0 : d.tax_amount,
        hst_treatment: treatment,
        document_type: d.document_type,
      });
      tavariExpenseSubtotal += reconciled.subtotalAbs;

      const amountVariance = Math.abs(
        reconciled.subtotalAbs + reconciled.taxAbs - reconciled.totalAbs,
      );
      if (amountVariance > 0.02) {
        issues.push({
          severity: "fail",
          draft_id: d.id,
          vendor: d.vendor_name_display,
          issue: "Tavari amounts do not reconcile (subtotal + tax ≠ total)",
          subtotal: d.subtotal,
          tax: d.tax_amount,
          total: d.total_amount,
        });
      }

      const piName = d.erpnext_purchase_invoice_id as string | null;
      if (!piName) {
        issues.push({ severity: "fail", draft_id: d.id, vendor: d.vendor_name_display, issue: "Missing ERPNext Purchase Invoice ID" });
        continue;
      }

      const piRes = await fetchErpNextDoc(baseUrl, apiKey, apiSecret, "Purchase Invoice", piName);
      if (!piRes.ok || !piRes.data) {
        issues.push({ severity: "fail", draft_id: d.id, vendor: d.vendor_name_display, pi: piName, issue: piRes.error || "PI not found in ERPNext" });
        continue;
      }

      const pi = piRes.data as Record<string, unknown>;
      const docstatus = Number(pi.docstatus || 0);
      if (docstatus !== 1) {
        issues.push({ severity: "fail", draft_id: d.id, vendor: d.vendor_name_display, pi: piName, issue: `PI not submitted (docstatus=${docstatus})` });
      }

      const piGrand = Math.abs(Number(pi.grand_total || 0));
      const totalVariance = Math.abs(piGrand - reconciled.totalAbs);
      if (totalVariance > 0.05) {
        issues.push({
          severity: "fail",
          draft_id: d.id,
          vendor: d.vendor_name_display,
          pi: piName,
          issue: "PI grand_total does not match Tavari total",
          tavari_total: reconciled.totalAbs,
          erpnext_grand_total: piGrand,
        });
      }

      const items = (pi.items as Array<Record<string, unknown>>) || [];
      const piSubtotal = round2(items.reduce((s, it) => s + Math.abs(Number(it.amount || 0)), 0));
      if (Math.abs(piSubtotal - reconciled.subtotalAbs) > 0.05) {
        issues.push({
          severity: "warn",
          draft_id: d.id,
          vendor: d.vendor_name_display,
          pi: piName,
          issue: "PI item subtotal differs from Tavari subtotal",
          tavari_subtotal: reconciled.subtotalAbs,
          erpnext_items_subtotal: piSubtotal,
        });
      }

      const expectedGl = d.is_fixed_asset
        ? String(d.asset_gl_account_erpnext || d.gl_account_erpnext || "")
        : String(d.gl_account_erpnext || "");
      const expectedGlWithSuffix = expectedGl && abbr && !expectedGl.endsWith(` - ${abbr}`)
        ? `${expectedGl} - ${abbr}`
        : expectedGl;
      const piAccounts = items.map((it) => String(it.expense_account || ""));
      if (expectedGlWithSuffix && piAccounts.length > 0 && !piAccounts.some((a) => a === expectedGlWithSuffix || a.includes(expectedGl))) {
        issues.push({
          severity: "warn",
          draft_id: d.id,
          vendor: d.vendor_name_display,
          pi: piName,
          issue: "PI expense account may not match draft GL",
          expected: expectedGlWithSuffix,
          actual: piAccounts,
        });
      }

      const taxes = (pi.taxes as Array<Record<string, unknown>>) || [];
      const piTax = round2(taxes.reduce((s, t) => s + Math.abs(Number(t.tax_amount || 0)), 0));
      const piTaxAccounts = taxes.map((t) => String(t.account_head || "")).filter(Boolean);
      const expectTax = ["recoverable", "included"].includes(treatment) ? reconciled.taxAbs : 0;
      if (Math.abs(piTax - expectTax) > 0.05) {
        issues.push({
          severity: treatment === "exempt" && piTax > 0 ? "fail" : "warn",
          draft_id: d.id,
          vendor: d.vendor_name_display,
          pi: piName,
          issue: "PI tax does not match Tavari HST",
          tavari_tax: expectTax,
          erpnext_tax: piTax,
          hst_treatment: treatment,
        });
      }

      if (reconciled.totalAbs < 0.02) {
        issues.push({ severity: "fail", draft_id: d.id, vendor: d.vendor_name_display, pi: piName, issue: "Near-zero expense total — likely bad extraction/post" });
      }

      if (d.is_fixed_asset && !d.fixed_asset_id) {
        issues.push({ severity: "fail", draft_id: d.id, vendor: d.vendor_name_display, pi: piName, issue: "Fixed asset flag set but no accounting_fixed_assets row" });
      }

      rows.push({
        vendor: d.vendor_name_display,
        date: d.transaction_date,
        invoice: d.invoice_number,
        pi: piName,
        gl: expectedGl,
        fixed_asset: !!d.is_fixed_asset,
        hst: treatment,
        subtotal: reconciled.subtotalAbs,
        tax: reconciled.taxAbs,
        total: reconciled.totalAbs,
        invoice_currency: d.invoice_currency,
        cad_settlement_total: d.cad_settlement_total,
        posted_cad: reconciled.usedCadSettlement,
        erpnext_grand_total: piGrand,
        erpnext_tax: piTax,
        erpnext_tax_accounts: piTaxAccounts,
        status: docstatus === 1 ? "submitted" : "draft",
      });
    }

    const tavariItc = sumPostedExpenseRecoverableItc(expenseRowsForItc);

    const { data: assets } = await supabase
      .from("accounting_fixed_assets")
      .select("id, name, cost, gl_asset_account_erpnext, draft_expense_id")
      .eq("business_id", businessId);

    const duplicateInvoices = (drafts || [])
      .filter((d) => d.invoice_number)
      .reduce((acc: Record<string, number>, d) => {
        const key = `${d.vendor_name_display}|${d.invoice_number}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
    for (const [key, count] of Object.entries(duplicateInvoices)) {
      if (count > 1) {
        issues.push({ severity: "warn", issue: `Duplicate vendor+invoice number posted ${count} times`, key });
      }
    }

    let glEntryItc: number | null = null;
    let glEntryItcCount = 0;
    let glEntryDetails: Array<Record<string, unknown>> = [];
    const recoverableLogical = String(config.hst_recoverable_account_erpnext || "").trim();
    const collectedLogical = String(config.hst_collected_account_erpnext || "").trim();
    const companyName = String(config.erpnext_company_name || "").trim();
    if (baseUrl && apiKey && abbr && body.from_date && body.to_date) {
      const fetchGlDetails = async (logical: string) => {
        if (!logical) return { account: "", net: 0, entries: [] as Array<Record<string, unknown>> };
        const account = appendCompanySuffix(logical, abbr);
        const filters: unknown[][] = [
          ["account", "=", account],
          ["posting_date", ">=", body.from_date!],
          ["posting_date", "<=", body.to_date!],
          ["company", "=", companyName],
          ["is_cancelled", "=", 0],
        ];
        const fields = ["posting_date", "voucher_type", "voucher_no", "debit_in_account_currency", "credit_in_account_currency"];
        const filtersEnc = encodeURIComponent(JSON.stringify(filters));
        const fieldsEnc = encodeURIComponent(JSON.stringify(fields));
        const glResource = encodeURIComponent("GL Entry");
        const res = await fetch(
          `${baseUrl}/api/resource/${glResource}?filters=${filtersEnc}&fields=${fieldsEnc}&limit_page_length=500&order_by=posting_date asc`,
          { headers: { Authorization: `token ${apiKey}:${apiSecret}` } },
        );
        const payload = await res.json().catch(() => ({})) as { data?: Array<Record<string, unknown>> };
        const entries = payload.data || [];
        const net = round2(entries.reduce((s, row) => {
          const debit = Number(row.debit_in_account_currency || 0) || 0;
          const credit = Number(row.credit_in_account_currency || 0) || 0;
          return s + debit - credit;
        }, 0));
        return { account, net: Math.max(0, net), entries };
      };

      if (recoverableLogical) {
        const gl = await fetchGlDetails(recoverableLogical);
        glEntryItc = round2(gl.net);
        glEntryItcCount = gl.entries.length;
        glEntryDetails = gl.entries.map((row) => ({
          account: gl.account,
          date: row.posting_date,
          voucher_type: row.voucher_type,
          voucher_no: row.voucher_no,
          debit: Number(row.debit_in_account_currency || 0) || 0,
          credit: Number(row.credit_in_account_currency || 0) || 0,
        }));
        const itcVariance = round2(Math.abs(glEntryItc - round2(tavariItc)));
        if (itcVariance > 0.05) {
          const piTaxByVoucher = new Map(
            (rows as Array<Record<string, unknown>>)
              .filter((r) => Number(r.erpnext_tax || 0) > 0)
              .map((r) => [String(r.pi), { vendor: r.vendor, tax: r.erpnext_tax, accounts: r.erpnext_tax_accounts }]),
          );
          const glVouchers = new Set(glEntryDetails.map((e) => String(e.voucher_no || "")));
          const missingFromGl = [...piTaxByVoucher.entries()]
            .filter(([pi]) => !glVouchers.has(pi))
            .map(([pi, info]) => ({ pi, ...info }));
          issues.push({
            severity: itcVariance > 1 ? "fail" : "warn",
            issue: "Tavari posted ITC does not match GL Entry net debits on recoverable account",
            tavari_itc: round2(tavariItc),
            gl_entry_itc: glEntryItc,
            variance: itcVariance,
            account: gl.account,
            gl_entry_count: glEntryItcCount,
            pis_missing_gst_gl: missingFromGl,
          });
        }
      }

      if (collectedLogical) {
        const hstGl = await fetchGlDetails(collectedLogical);
        const hstOnCollected = round2(hstGl.entries.reduce((s, row) => s + (Number(row.debit || 0) - Number(row.credit || 0)), 0));
        if (Math.abs(hstOnCollected) > 0.05) {
          issues.push({
            severity: "warn",
            issue: "Unexpected net debits on HST Collected account in period (possible mis-posted purchase ITC)",
            account: hstGl.account,
            net_debits: hstOnCollected,
            entries: hstGl.entries,
          });
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      business_id: businessId,
      company_abbr: abbr,
      hst_recoverable_account: config.hst_recoverable_account_erpnext,
      posted_count: (drafts || []).length,
      tavari_itc_total: round2(tavariItc),
      gl_entry_itc: glEntryItc,
      gl_entry_itc_count: glEntryItcCount,
      gl_entry_details: glEntryDetails,
      tavari_expense_subtotal: round2(tavariExpenseSubtotal),
      fixed_assets: assets || [],
      issues,
      rows,
      summary: {
        pass: issues.filter((i) => i.severity === "fail").length === 0,
        fail_count: issues.filter((i) => i.severity === "fail").length,
        warn_count: issues.filter((i) => i.severity === "warn").length,
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
