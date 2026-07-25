// Extract invoice data from a draft's attachment and UPDATE the draft.
// Called async after accounting-process-inbound-invoice creates the draft.
// POST body: { draft_id }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { extractInvoiceFieldsFromText, inferHstTreatmentFromAmounts, finalizeExpenseAmounts, isExpenseAmountsIncomplete, reconcileExtractedAmounts, isWeakExtraction, extractionGotValidData, isPaymentConfirmationDocument, hasExplicitTaxBreakdown, type InvoiceTextFallback } from "../_shared/invoiceTextFallback.ts";
import { normalizeEmailBodyForExtraction } from "../_shared/emailBodyNormalize.ts";
import { applyCreditMemoExtraction } from "../_shared/invoiceDocumentDetect.ts";
import { syncDuplicateFlagsForDraft } from "../_shared/draftExpenseDuplicates.ts";
import { extractTextFromPdfBytes } from "../_shared/pdfTextExtract.ts";
import { todayInTimezone } from "../_shared/businessDayWindow.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const round2 = (n: number | null) => (n != null && !Number.isNaN(n) ? Math.round(Number(n) * 100) / 100 : null);
const DATE_WINDOW_DAYS = 60;

function getBearerToken(req: Request): string {
  const authHeader = req.headers.get("Authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
}

function inDateWindow(txDate: string | null, expenseDate: string | null) {
  if (!txDate || !expenseDate) return false;
  const d = new Date(txDate).getTime();
  const e = new Date(expenseDate).getTime();
  return Math.abs(d - e) <= DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length <= 8192) {
    return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
  }
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    const chunk = bytes.subarray(i, Math.min(i + 8192, bytes.length));
    parts.push(String.fromCharCode.apply(null, Array.from(chunk)));
  }
  return btoa(parts.join(""));
}

type Extracted = {
  vendor_name?: string | null;
  invoice_date?: string | null;
  subtotal?: number | null;
  tax_amount?: number | null;
  total_amount?: number | null;
  invoice_number?: string | null;
  invoice_currency?: string | null;
  suggested_category_id?: string | null;
  inferred_hst_rate?: number | null;
  line_items?: unknown[];
  document_type?: "invoice" | "credit_memo";
  credit_memo_against?: string | null;
};

function mergeEmailFallbackIntoExtracted(extracted: Extracted, fallback: InvoiceTextFallback, preferEmail: boolean): Extracted {
  const out = { ...extracted };
  const pickStr = (primary: string | null | undefined, fb: string | null) => {
    if (preferEmail && fb) return fb;
    if (!primary?.trim()) return fb;
    if (/(fournier|christian|chriastian)/i.test(primary) && fb) return fb;
    return primary;
  };
  const pickNum = (primary: number | null | undefined, fb: number | null) => {
    if (preferEmail && fb != null) return fb;
    if (primary == null || Math.abs(Number(primary)) < 0.01) return fb ?? primary ?? null;
    return primary;
  };
  out.vendor_name = pickStr(extracted.vendor_name, fallback.vendor_name);
  out.invoice_number = pickStr(extracted.invoice_number, fallback.invoice_number);
  out.invoice_date = pickStr(extracted.invoice_date, fallback.invoice_date);
  out.invoice_currency = pickStr(extracted.invoice_currency, fallback.invoice_currency) || extracted.invoice_currency || "CAD";
  out.subtotal = pickNum(extracted.subtotal, fallback.subtotal);
  out.tax_amount = pickNum(extracted.tax_amount, fallback.tax_amount);
  out.total_amount = pickNum(extracted.total_amount, fallback.total_amount);
  return out;
}

function applyTextSourceReconciliation(extracted: Extracted, ...textSources: string[]): Extracted {
  const combined = textSources.filter((t) => t.trim()).join("\n\n");
  if (!combined.trim()) return extracted;
  const fallback = extractInvoiceFieldsFromText(combined);
  const merged = mergeEmailFallbackIntoExtracted(extracted, fallback, isWeakExtraction(extracted));
  const reconciled = reconcileExtractedAmounts(
    {
      subtotal: merged.subtotal ?? null,
      tax_amount: merged.tax_amount ?? null,
      total_amount: merged.total_amount ?? null,
    },
    fallback,
  );
  return {
    ...merged,
    subtotal: reconciled.subtotal,
    tax_amount: reconciled.tax_amount,
    total_amount: reconciled.total_amount,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const log = (msg: string, data?: unknown) => {
    console.log(`[extract-draft-expense] ${msg}`, data !== undefined ? JSON.stringify(data) : "");
  };
  try {
    const bearerToken = getBearerToken(req);
    if (!bearerToken) {
      log("ERROR: Missing Authorization header");
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const { draft_id, attempt, max_attempts } = body as { draft_id?: string; attempt?: number; max_attempts?: number };
    log("ENTRY", { draft_id });
    if (!draft_id) {
      log("ERROR: Missing draft_id");
      return new Response(JSON.stringify({ error: "draft_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: draftRow, error: draftErr } = await supabase
      .from("accounting_draft_expenses")
      .select("id, business_id, received_email_id, attachment_id, invoice_file_path")
      .eq("id", draft_id)
      .single();
    if (draftErr || !draftRow) {
      log("ERROR: Draft not found", { draftErr: String(draftErr) });
      return new Response(JSON.stringify({ error: "Draft not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    log("Draft loaded", { business_id: draftRow.business_id, invoice_file_path: draftRow.invoice_file_path });

    const businessId = draftRow.business_id as string;
    const { data: bizConfig } = await supabase
      .from("accounting_business_config")
      .select("business_timezone")
      .eq("business_id", businessId)
      .maybeSingle();
    const businessTimezone = String(bizConfig?.business_timezone || "America/Toronto").trim() || "America/Toronto";
    const isInternalCaller = bearerToken === SUPABASE_SERVICE_ROLE_KEY;
    if (!isInternalCaller) {
      const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${bearerToken}` } }
      });
      const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
      const userId = userData?.user?.id;
      if (userErr || !userId) {
        log("ERROR: Invalid user token", { userErr: String(userErr) });
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: membership, error: membershipErr } = await supabaseUser
        .from("business_users")
        .select("user_id, role")
        .eq("business_id", businessId)
        .eq("user_id", userId)
        .in("role", ["owner", "manager", "admin"])
        .maybeSingle();
      if (membershipErr || !membership) {
        log("ERROR: Access denied to draft business", { businessId, userId, membershipErr: String(membershipErr) });
        return new Response(JSON.stringify({ error: "Access denied" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const storagePath = (draftRow.invoice_file_path || "") as string;
    if (!storagePath) {
      log("ERROR: Draft has no invoice_file_path");
      return new Response(JSON.stringify({ error: "Draft has no attachment" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: attRow } = await supabase
      .from("received_email_attachments")
      .select("content_type")
      .eq("id", draftRow.attachment_id)
      .single();
    const contentType = ((attRow as { content_type?: string })?.content_type || "application/pdf").toLowerCase();
    const isPdf = contentType === "application/pdf";
    const isImage = /^image\/(jpeg|png|webp)$/i.test(contentType);
    log("Attachment content_type", { contentType, isPdf, isImage });

    log("Downloading from storage", { bucket: "expense-invoices", storagePath });
    const { data: fileData, error: downloadErr } = await supabase.storage.from("expense-invoices").download(storagePath);
    if (downloadErr || !fileData) {
      log("ERROR: Storage download failed", { downloadErr: String(downloadErr), message: downloadErr?.message });
      return new Response(JSON.stringify({ error: "Failed to download attachment" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    log("Download OK", { size: fileData.size });

    const bytes = new Uint8Array(await fileData.arrayBuffer());
    let extracted: Extracted = {};
    let pdfText = "";

    const { data: categories } = await supabase
      .from("accounting_expense_categories")
      .select("id, name")
      .eq("business_id", businessId)
      .order("sort_order")
      .order("name");
    const categoriesForApi = (categories || []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }));

    let emailText = "";
    let emailSubject = "";
    if (draftRow.received_email_id) {
      const { data: emailRow } = await supabase
        .from("received_emails")
        .select("body_text, body_html, subject")
        .eq("id", draftRow.received_email_id)
        .maybeSingle();
      emailSubject = String((emailRow as { subject?: string })?.subject || "");
      emailText = normalizeEmailBodyForExtraction(
        (emailRow as { body_text?: string })?.body_text,
        (emailRow as { body_html?: string })?.body_html,
      );
      log("Normalized email body", { chars: emailText.length, preview: emailText.slice(0, 120), subject: emailSubject.slice(0, 80) });
    }

    if (isPdf) {
      try {
        pdfText = await extractTextFromPdfBytes(bytes);
        log("PDF text extracted", { chars: pdfText.length });
      } catch (e) {
        log("PDF text extraction skipped", { err: String(e) });
      }
    }

    if (isImage) {
      log("Extracting from image", { base64Len: bytesToBase64(bytes).length });
      const imageBase64 = bytesToBase64(bytes);
      const extractRes = await fetch(`${SUPABASE_URL}/functions/v1/accounting-extract-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({
          business_id: businessId,
          image_base64: imageBase64,
          mime_type: contentType || "image/jpeg",
          categories: categoriesForApi,
          supplementary_text: emailText.slice(0, 24000) || undefined,
        })
      });
      const extractBody = await extractRes.text();
      log("accounting-extract-invoice (image) response", { status: extractRes.status, bodyPreview: extractBody?.slice(0, 300) });
      if (extractRes.ok) {
        try {
          extracted = JSON.parse(extractBody) as Extracted;
          log("Parsed image extract", { vendor_name: extracted.vendor_name, total_amount: extracted.total_amount });
        } catch (e) {
          log("ERROR: Failed to parse image extract response", { err: String(e) });
        }
      } else {
        log("ERROR: Image extract HTTP failed", { status: extractRes.status, body: extractBody?.slice(0, 200) });
      }
    } else if (isPdf) {
      const extractPayload: Record<string, unknown> = {
        business_id: businessId,
        categories: categoriesForApi,
        supplementary_text: emailText.slice(0, 24000) || undefined,
      };
      if (pdfText.trim()) {
        log("Extracting PDF via invoice_text (text layer present)", { chars: pdfText.length });
        extractPayload.invoice_text = pdfText.slice(0, 24000);
      } else {
        log("Extracting PDF via pdf_base64 (no text layer)");
        extractPayload.pdf_base64 = bytesToBase64(bytes);
      }
      const extractRes = await fetch(`${SUPABASE_URL}/functions/v1/accounting-extract-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify(extractPayload),
      });
      const extractBody = await extractRes.text();
      log("accounting-extract-invoice (PDF) response", { status: extractRes.status, bodyPreview: extractBody?.slice(0, 300) });
      if (extractRes.ok) {
        try {
          extracted = JSON.parse(extractBody) as Extracted;
          log("Parsed PDF extract", { vendor_name: extracted.vendor_name, total_amount: extracted.total_amount, tax_amount: extracted.tax_amount });
        } catch (e) {
          log("ERROR: Failed to parse PDF extract response", { err: String(e) });
        }
      } else {
        log("ERROR: PDF extract HTTP failed", { status: extractRes.status, body: extractBody?.slice(0, 200) });
      }
    }

    const extractionWeak = isWeakExtraction(extracted);
    if (emailText.trim()) {
      const emailFallback = extractInvoiceFieldsFromText(emailText);
      log("Email regex fallback", emailFallback);
      extracted = mergeEmailFallbackIntoExtracted(extracted, emailFallback, extractionWeak);

      if (extractionWeak) {
        log("Weak extraction — running LLM extract on email body");
        const emailExtractRes = await fetch(`${SUPABASE_URL}/functions/v1/accounting-extract-invoice`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ business_id: businessId, invoice_text: emailText.slice(0, 24000), categories: categoriesForApi }),
        });
        const emailExtractBody = await emailExtractRes.text();
        if (emailExtractRes.ok) {
          try {
            const emailLlm = JSON.parse(emailExtractBody) as Extracted;
            log("Email LLM extract", { vendor: emailLlm.vendor_name, total: emailLlm.total_amount, tax: emailLlm.tax_amount });
            extracted = mergeEmailFallbackIntoExtracted(extracted, {
              vendor_name: emailLlm.vendor_name ?? null,
              invoice_number: emailLlm.invoice_number ?? null,
              invoice_date: emailLlm.invoice_date ?? null,
              invoice_currency: emailLlm.invoice_currency ?? null,
              subtotal: emailLlm.subtotal ?? null,
              tax_amount: emailLlm.tax_amount ?? null,
              total_amount: emailLlm.total_amount ?? null,
            }, true);
            if (emailLlm.document_type) extracted.document_type = emailLlm.document_type;
            if (emailLlm.credit_memo_against) extracted.credit_memo_against = emailLlm.credit_memo_against;
          } catch (e) {
            log("ERROR: Failed to parse email LLM extract", { err: String(e) });
          }
        } else {
          log("Email LLM extract failed", { status: emailExtractRes.status, body: emailExtractBody?.slice(0, 200) });
        }
      }
    }

    if (pdfText.trim() && isExpenseAmountsIncomplete({
      subtotal: extracted.subtotal ?? null,
      tax_amount: extracted.tax_amount ?? null,
      total_amount: extracted.total_amount ?? null,
    })) {
      const pdfFallback = extractInvoiceFieldsFromText(pdfText);
      extracted = mergeEmailFallbackIntoExtracted(extracted, pdfFallback, true);
      log("PDF text fallback merge (incomplete amounts)", pdfFallback);
    }

    extracted = applyTextSourceReconciliation(extracted, emailText, pdfText);

    const creditMemoSource = pdfText.trim() || emailText.trim();
    if (!extracted.document_type && creditMemoSource) {
      try {
        const creditMemo = applyCreditMemoExtraction(creditMemoSource, extracted);
        if (creditMemo.document_type === "credit_memo") {
          extracted.document_type = "credit_memo";
          extracted.credit_memo_against = creditMemo.credit_memo_against;
          extracted.invoice_number = creditMemo.invoice_number ?? extracted.invoice_number;
          extracted.subtotal = creditMemo.subtotal ?? extracted.subtotal;
          extracted.tax_amount = creditMemo.tax_amount ?? extracted.tax_amount;
          extracted.total_amount = creditMemo.total_amount ?? extracted.total_amount;
          log("Credit memo fallback from text", creditMemo);
        }
      } catch (e) {
        log("Credit memo text check skipped", { err: String(e) });
      }
    }

    let totalAmount = extracted.total_amount != null && !Number.isNaN(Number(extracted.total_amount))
      ? Number(extracted.total_amount)
      : 0;
    log("Computed totals", { totalAmount, vendor_name: extracted.vendor_name ?? null });

    let matchedVendorId: string | null = null;
    let draftCategoryId: string | null = extracted.suggested_category_id || null;
    let draftGlAccount: string | null = null;
    let draftHstTreatment: string | null = null;
    let categoryDefaultHst: string | null = null;
    const vendorName = (extracted.vendor_name || "").trim();

    const { data: vendorRules } = await supabase
      .from("accounting_vendor_rules")
      .select("match_pattern, vendor_id, expense_category_id, gl_account_erpnext, hst_treatment, priority")
      .eq("business_id", businessId)
      .order("priority", { ascending: false });

    const { data: vendors } = await supabase.from("accounting_vendors").select("id, name, default_expense_category_id, default_hst_treatment").eq("business_id", businessId);
    const vendorList = (vendors || []) as { id: string; name: string | null; default_expense_category_id: string | null; default_hst_treatment?: string | null }[];

    const ruleMatchText = vendorName;
    const sortedRules = [...(vendorRules || [])].sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
    const matchedRule = sortedRules.find((rule) => {
      const needle = String(rule.match_pattern || "").trim().toLowerCase();
      const hay = ruleMatchText.toLowerCase();
      return needle && hay.includes(needle);
    });

    if (vendorName) {
      const exact = vendorList.find((v) => (v.name || "").trim().toLowerCase() === vendorName.toLowerCase());
      const matched = exact || vendorList.find((v) =>
        (v.name || "").toLowerCase().includes(vendorName.toLowerCase()) || vendorName.toLowerCase().includes((v.name || "").toLowerCase())
      );
      if (matched) {
        matchedVendorId = matched.id;
        if (matched.default_expense_category_id) draftCategoryId = matched.default_expense_category_id;
        if (matched.default_hst_treatment) draftHstTreatment = matched.default_hst_treatment;
      }
    }

    if (matchedRule) {
      if (matchedRule.vendor_id) matchedVendorId = matchedRule.vendor_id;
      if (matchedRule.expense_category_id) draftCategoryId = matchedRule.expense_category_id;
      if (matchedRule.gl_account_erpnext) draftGlAccount = matchedRule.gl_account_erpnext;
      if (matchedRule.hst_treatment) draftHstTreatment = matchedRule.hst_treatment;
    }

    if (draftCategoryId && !draftGlAccount) {
      const { data: cat } = await supabase.from("accounting_expense_categories").select("gl_account_erpnext, default_hst_treatment").eq("id", draftCategoryId).single();
      if (cat?.gl_account_erpnext) draftGlAccount = cat.gl_account_erpnext as string;
      if (cat?.default_hst_treatment) categoryDefaultHst = cat.default_hst_treatment as string;
    }

    const inferredHst = inferHstTreatmentFromAmounts(
      extracted.tax_amount,
      extracted.subtotal,
      extracted.total_amount,
      emailText,
    );
    if (!draftHstTreatment && inferredHst) draftHstTreatment = inferredHst;
    if (!draftHstTreatment && categoryDefaultHst) draftHstTreatment = categoryDefaultHst;
    if (draftHstTreatment === "exempt" && (extracted.tax_amount == null || extracted.tax_amount === 0)) {
      extracted.tax_amount = 0;
    }

    const paymentConfirmationOnly = isPaymentConfirmationDocument(`${emailSubject}\n${emailText}`, emailSubject)
      && !hasExplicitTaxBreakdown(emailText);

    const finalized = finalizeExpenseAmounts({
      subtotal: extracted.subtotal ?? null,
      tax_amount: extracted.tax_amount ?? null,
      total_amount: totalAmount,
    }, { singleTotalNoTax: paymentConfirmationOnly });
    extracted.subtotal = finalized.subtotal;
    extracted.tax_amount = finalized.tax_amount;
    if (finalized.total_amount != null) {
      totalAmount = Number(finalized.total_amount);
    }

    if (paymentConfirmationOnly) {
      extracted.tax_amount = 0;
      if (extracted.subtotal == null && totalAmount) {
        extracted.subtotal = totalAmount;
      }
      if (!draftHstTreatment) draftHstTreatment = "exempt";
    }

    const gotData = extractionGotValidData({
      subtotal: extracted.subtotal ?? null,
      tax_amount: extracted.tax_amount ?? null,
      total_amount: totalAmount,
    });
    const isFinalAttempt = typeof max_attempts === "number" && typeof attempt === "number" && attempt >= max_attempts;
    const markExtractionComplete = gotData || isFinalAttempt;

    log("Updating draft", { vendor_id: matchedVendorId, total_amount: totalAmount, got_data: gotData, markExtractionComplete, attempt, max_attempts });
    const inferredRate = extracted.inferred_hst_rate != null && !Number.isNaN(Number(extracted.inferred_hst_rate)) && Number(extracted.inferred_hst_rate) >= 0 && Number(extracted.inferred_hst_rate) <= 0.2
      ? Number(extracted.inferred_hst_rate) : null;

    const { data: bankMatch } = await supabase
      .from("accounting_bank_transactions")
      .select("id")
      .eq("matched_draft_expense_id", draft_id)
      .limit(1)
      .maybeSingle();

    const invoiceDate = extracted.invoice_date || null;
    const draftUpdate: Record<string, unknown> = {
      vendor_id: matchedVendorId,
      vendor_name_display: extracted.vendor_name || null,
      invoice_date: invoiceDate,
      subtotal: extracted.subtotal ?? null,
      tax_amount: extracted.tax_amount ?? null,
      total_amount: totalAmount,
      invoice_number: extracted.invoice_number || null,
      invoice_currency: (extracted.invoice_currency || 'CAD').toUpperCase(),
      expense_category_id: draftCategoryId,
      gl_account_erpnext: draftGlAccount,
      ...(draftHstTreatment ? { hst_treatment: draftHstTreatment } : {}),
      inferred_hst_rate: inferredRate,
      ...(markExtractionComplete ? { extraction_completed_at: new Date().toISOString() } : {}),
      document_type: extracted.document_type === "credit_memo" ? "credit_memo" : "invoice",
      credit_memo_against: extracted.credit_memo_against || null,
    };
    if (invoiceDate && !bankMatch?.id) {
      draftUpdate.transaction_date = invoiceDate;
    }

    const { error: updateErr } = await supabase
      .from("accounting_draft_expenses")
      .update(draftUpdate)
      .eq("id", draft_id);

    if (updateErr) {
      log("ERROR: Draft update failed", { updateErr: String(updateErr) });
      return new Response(JSON.stringify({ error: "Failed to update draft" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    log("Draft updated successfully");

    await syncDuplicateFlagsForDraft(supabase, businessId, draft_id);

    const extractedLines = Array.isArray(extracted.line_items) ? extracted.line_items : [];
    if (extractedLines.length >= 2) {
      await supabase.from("accounting_draft_expense_lines").delete().eq("draft_expense_id", draft_id);
      const { data: categories } = await supabase.from("accounting_expense_categories").select("id, gl_account_erpnext").eq("business_id", businessId);
      const catMap = Object.fromEntries((categories || []).map((c: { id: string; gl_account_erpnext?: string }) => [c.id, c.gl_account_erpnext]));
      const rows = extractedLines
        .map((line: { description?: string; amount?: number; tax_amount?: number; suggested_category_id?: string }, index: number) => {
          const amount = Number(line.amount ?? 0);
          if (!amount) return null;
          const catId = line.suggested_category_id || draftCategoryId;
          return {
            draft_expense_id: draft_id,
            business_id: businessId,
            description: line.description?.trim() || null,
            amount,
            tax_amount: Number(line.tax_amount ?? 0) || 0,
            expense_category_id: catId || null,
            gl_account_erpnext: catId ? (catMap[catId] || draftGlAccount) : draftGlAccount,
            sort_order: index
          };
        })
        .filter(Boolean);
      if (rows.length > 0) {
        await supabase.from("accounting_draft_expense_lines").insert(rows);
      }
    }

    if (totalAmount > 0) {
      const { data: imports } = await supabase.from("accounting_bank_imports").select("id").eq("business_id", businessId);
      const importIds = (imports || []).map((i: { id: string }) => i.id);
      if (importIds.length > 0) {
        const { data: pendingTx } = await supabase
          .from("accounting_bank_transactions")
          .select("id, transaction_date, amount, debit_credit")
          .in("import_id", importIds)
          .eq("status", "pending")
          .is("matched_draft_expense_id", null);
        const amount = Math.abs(round2(totalAmount)!);
        const expenseDate = extracted.invoice_date || todayInTimezone(businessTimezone);
        const candidates = (pendingTx || []).filter(
          (t: { amount: number; debit_credit: string; transaction_date: string }) =>
            t.debit_credit === "debit" && Math.abs(round2(t.amount)!) === amount && inDateWindow(t.transaction_date, expenseDate)
        );
        if (candidates.length === 1) {
          const tx = candidates[0] as { id: string; transaction_date: string };
          await supabase.from("accounting_bank_transaction_draft_matches").insert({ bank_transaction_id: tx.id, draft_expense_id: draft_id });
          await supabase.from("accounting_bank_transactions").update({ matched_draft_expense_id: draft_id, status: "matched" }).eq("id", tx.id);
          await supabase.from("accounting_draft_expenses").update({ transaction_date: tx.transaction_date }).eq("id", draft_id);
        }
      }
    }

    log("EXIT DONE", { draft_id, vendor: extracted.vendor_name ?? null, total: totalAmount, got_data: gotData, markExtractionComplete, attempt, max_attempts });
    return new Response(
      JSON.stringify({
        success: true,
        extracted_vendor: extracted.vendor_name ?? null,
        extracted_total: totalAmount,
        got_data: gotData
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[extract-draft-expense] FATAL", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
