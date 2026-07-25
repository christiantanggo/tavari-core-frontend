// Extracts vendor, amounts, invoice number, and suggested category from invoice text (or image) using OpenAI.
// POST body: { business_id, invoice_text?, image_base64?, mime_type?, categories: [{ id, name }] }
// Set OPENAI_API_KEY in Supabase Edge Function secrets.
// Deploy: supabase functions deploy accounting-extract-invoice

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { extractInvoiceFieldsFromText, reconcileExtractedAmounts, normalizeExpenseAmount, normalizeExtractedAmount, finalizeExpenseAmounts } from '../_shared/invoiceTextFallback.ts';
import { applyCreditMemoExtraction } from '../_shared/invoiceDocumentDetect.ts';
import { extractTextFromPdfBytes } from '../_shared/pdfTextExtract.ts';
import { normalizeEmailBodyForExtraction } from '../_shared/emailBodyNormalize.ts';
import { calendarDateFromMonthNameDayYear, normalizeCalendarDateString } from '../_shared/businessDayWindow.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function corsResponse(body: string | null, status: number) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, ...(body ? { 'Content-Type': 'application/json' } : {}) }
  });
}

type Category = { id: string; name: string };

const log = (msg: string, data?: unknown) => {
  console.log(`[extract-invoice] ${msg}`, data !== undefined ? JSON.stringify(data) : "");
};

const VISION_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Models often return "Name (id: uuid)" — persist only a real category UUID. */
function normalizeSuggestedCategoryId(raw: unknown, categories: Category[]): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (UUID_RE.test(s)) {
    return categories.some((c) => c.id === s) ? s : null;
  }
  const idInParens = s.match(/\(\s*id\s*:\s*([0-9a-f-]{36})\s*\)/i);
  if (idInParens?.[1] && UUID_RE.test(idInParens[1])) {
    const id = idInParens[1];
    return categories.some((c) => c.id === id) ? id : null;
  }
  const anyUuid = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  if (anyUuid?.[0]) {
    const id = anyUuid[0];
    return categories.some((c) => c.id === id) ? id : null;
  }
  const byName = categories.find((c) => c.name.trim().toLowerCase() === s.toLowerCase());
  return byName?.id ?? null;
}

serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') {
      return corsResponse(null, 204);
    }
    if (req.method !== 'POST') {
      return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405);
    }

    log("ENTRY");
    const json = (obj: Record<string, unknown>, status = 200) =>
      corsResponse(JSON.stringify(obj), status);
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      log("ERROR: No Authorization header");
      return json({ error: 'Unauthorized' });
    }

    const body = (await req.json().catch(() => ({}))) as {
      business_id?: string;
      invoice_text?: string;
      supplementary_text?: string;
      pdf_base64?: string;
      image_base64?: string;
      mime_type?: string;
      categories?: Category[];
    };

    const businessId = body?.business_id;
    let invoiceText = normalizeEmailBodyForExtraction(body?.invoice_text || "", null);
    const supplementaryText = normalizeEmailBodyForExtraction(body?.supplementary_text || "", null);
    const textForFallback = [invoiceText, supplementaryText].filter((t) => t.trim()).join("\n\n");
    const pdfBase64 = body?.pdf_base64;
    const imageBase64 = body?.image_base64;
    const mimeType = body?.mime_type || 'image/jpeg';
    const categories = Array.isArray(body?.categories) ? body.categories : [];

    log("Request parsed", { businessId, hasInvoiceText: !!invoiceText && invoiceText.length > 0, hasImageBase64: !!imageBase64, imageBase64Len: imageBase64?.length ?? 0, categoriesCount: categories.length });

    if (!businessId) {
      log("ERROR: Missing business_id");
      return json({ error: 'Missing business_id' });
    }

    if (!invoiceText && pdfBase64) {
      try {
        const binary = atob(pdfBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        invoiceText = (await extractTextFromPdfBytes(bytes)).trim();
        log("Extracted invoice text from pdf_base64", { chars: invoiceText.length });
      } catch (e) {
        log("ERROR: pdf_base64 text extraction failed", { err: e instanceof Error ? e.message : String(e) });
      }
    }

    if (!invoiceText && !imageBase64) {
      log("ERROR: No invoice_text or image_base64");
      return json({ error: 'Provide invoice_text or image_base64' });
    }
    const normalizedMime = (mimeType || 'image/jpeg').toLowerCase().split(';')[0].trim();
    if (imageBase64 && !VISION_MIME_TYPES.has(normalizedMime)) {
      log("ERROR: Unsupported vision mime type", { normalizedMime });
      return json({ error: `Unsupported image mime type "${normalizedMime}". Extract text from the PDF first or send jpeg/png/webp.` });
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      log("ERROR: OPENAI_API_KEY not set");
      return json({ error: 'OPENAI_API_KEY not configured for invoice extraction' });
    }
    log("OPENAI_API_KEY present");

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const isServiceRoleCall = serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`;

    if (!isServiceRoleCall) {
      const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data: { user } } = await supabaseUser.auth.getUser();
      const userId = user?.id;
      const { data: membership } = await supabaseUser
        .from('business_users')
        .select('user_id, role')
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .in('role', ['owner', 'manager', 'admin'])
        .maybeSingle();
      if (!membership) return json({ error: 'Access denied to this business' });
    }

    const categoryList = categories.map((c) => `${c.name} (id: ${c.id})`).join(', ') || 'None';

    const systemPrompt = `You extract structured data from an invoice or receipt (text or image). Receipts include thermal/POS slips: use the store name at the top as vendor_name, the transaction date (e.g. DD/MM/YY or 26/02/11 → YYYY-MM-DD), and the final total (e.g. "Total", "CAD$", "CREDIT TN"). Return ONLY valid JSON with these keys (use null for missing):
- vendor_name: string (company/supplier/store name, e.g. "REAL CANADIAN SUPERSTORE")
- invoice_date: string or null - REQUIRED when visible. The date on the document (invoice date, transaction date, or receipt date). Return in YYYY-MM-DD only (e.g. 2024-01-15). For DD/MM/YY assume 20YY if 2-digit year. Never use today's date or the email forward/Sent date; use the date shown on the invoice or receipt body only.
- subtotal: number (the invoice pre-tax total ONLY—look for "SUB-TOTAL BEFORE TAXES", "subtotal before tax", "pre-tax", or the single amount that appears just before tax lines. Do NOT use a category line total or "TOT" column from a recap row (e.g. 32.88 from "CANNED AND DRY ... 32.88" is wrong; the subtotal is 49.10 from "INV SUB-TOTAL BEFORE TAXES 49.10"). Use negative for expense.)
- total_amount: number (the FINAL invoice total the customer pays—look for "ORDER TOTAL", "TOTAL COMMANDE", "Amount Due", or the single final total. Do NOT use a category/recap line total (e.g. 32.88 from "CANNED AND DRY ... 32.88" is wrong; the real invoice total is the larger final amount, e.g. 55.48). Use negative for expense.)
- invoice_number: string or null - the document's invoice/reference identifier. Also extract when present: order_number, order_id (e.g. "Order ID: 10835272"), reference_number (or reference). We will use them in priority: 1) Invoice Number, 2) Order Number/Order ID, 3) Reference Number.
- invoice_currency: string - ISO 4217 currency code for amounts on the document (e.g. "CAD", "USD"). Use "USD" when the invoice says amounts are in USD; default "CAD" for Canadian invoices.
- suggested_category_id: string or null - pick the single best matching category ID from this list, or null: ${categoryList}
- line_items: optional array when the receipt clearly has multiple categories or product groups. Each object: { "description": string, "amount": number (pre-tax, negative for expense), "tax_amount": number or 0, "suggested_category_id": string or null }. Sum of line amounts should approximate subtotal. Omit or use empty array for single-category receipts.
- tax_breakdown: array of objects with "label" (string) and "amount" (number).
- tax_amount: number or null - optional single total tax if the invoice shows one total tax line; use negative for expense.

Amounts must be numbers. For expenses use negative values. No currency symbols. You MUST include invoice_date in YYYY-MM-DD whenever a date appears on the invoice.`;

    let userContent: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

    if (imageBase64) {
      const url = `data:${normalizedMime};base64,${imageBase64}`;
      userContent = [
        { type: 'text' as const, text: 'Extract from this invoice or receipt image. For receipts (thermal/POS): vendor = store name at top, date = transaction date in YYYY-MM-DD, total_amount = final total (Total / CAD$ / CREDIT amount). CRITICAL: (1) total_amount = the FINAL total the customer pays. (2) subtotal = pre-tax total when present. (3) List tax lines in tax_breakdown when present. Return vendor, invoice_date (YYYY-MM-DD), subtotal, total_amount, tax_breakdown, and best category. Category IDs: ' + categoryList },
        { type: 'image_url' as const, image_url: { url } }
      ];
    } else {
      userContent = `Extract from this invoice text. Include invoice date in YYYY-MM-DD and invoice/reference number when present. List every tax line (GST, HST, PST, etc.) in tax_breakdown with each amount.\n\nInvoice text:\n${invoiceText}`;
    }

    // gpt-4o-mini supports vision and has substantially higher throughput than
    // gpt-4o. iPhone/Genius Scan batches otherwise exhaust the gpt-4o rate limit.
    const model = 'gpt-4o-mini';
    log("Calling OpenAI API", { model, inputType: imageBase64 ? 'image' : 'text' });
    const openAiPayload = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_tokens: 1200,
      response_format: { type: 'json_object' }
    };

    let res: Response | null = null;
    let lastError = '';
    let upstreamErrorCode = '';
    let upstreamErrorType = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(openAiPayload)
      });
      if (res.ok) break;

      lastError = await res.text();
      try {
        const parsed = JSON.parse(lastError) as { error?: { code?: string; type?: string } };
        upstreamErrorCode = String(parsed?.error?.code || '');
        upstreamErrorType = String(parsed?.error?.type || '');
      } catch {
        upstreamErrorCode = '';
        upstreamErrorType = '';
      }
      log("ERROR: OpenAI API failed", {
        attempt: attempt + 1,
        status: res.status,
        statusText: res.statusText,
        upstreamErrorCode,
        upstreamErrorType,
        err: lastError?.slice(0, 300)
      });
      if (res.status !== 429 || attempt === 2) break;
      // Billing/quota limits do not recover with a short retry.
      if (/quota|billing|limit_reached/i.test(`${upstreamErrorCode} ${upstreamErrorType}`)) break;

      const retryAfterHeader = Number(res.headers.get('retry-after') || 0);
      const retryMs = retryAfterHeader > 0
        ? Math.min(retryAfterHeader * 1000, 12000)
        : [2500, 6000][attempt];
      await sleep(retryMs);
    }

    if (!res?.ok) {
      if (res?.status === 429) {
        const quotaExhausted = /quota|billing|limit_reached/i.test(`${upstreamErrorCode} ${upstreamErrorType}`);
        return json({
          error: quotaExhausted
            ? 'The OpenAI API quota for invoice extraction is exhausted. Add billing/credits or raise the project usage limit, then retry Extract.'
            : 'AI extraction is temporarily rate limited. The remaining invoices were paused; try Extract again in about a minute.',
          code: 'rate_limited',
          upstream_code: upstreamErrorCode || null,
          upstream_type: upstreamErrorType || null,
          retry_after_seconds: quotaExhausted ? null : Number(res.headers.get('retry-after') || 60)
        });
      }
      return json({ error: 'Extraction failed: ' + (res?.statusText || lastError.slice(0, 200)) });
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data?.choices?.[0]?.message?.content;
    log("OpenAI response", { hasContent: !!raw, contentPreview: raw?.slice(0, 100) });
    if (!raw) {
      log("ERROR: No extraction result in OpenAI response");
      return json({ error: 'No extraction result' });
    }

    let extracted: Record<string, unknown>;
    try {
      extracted = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json({ error: 'Invalid extraction format' });
    }

    log("LLM raw extraction", {
      subtotal: extracted.subtotal,
      total_amount: extracted.total_amount,
      tax_amount: extracted.tax_amount,
      tax_breakdown: Array.isArray(extracted.tax_breakdown) ? (extracted.tax_breakdown as { label?: string; amount?: unknown }[]).map((i) => ({ label: i?.label, amount: i?.amount })) : extracted.tax_breakdown
    });

    let vendor_name = typeof extracted.vendor_name === 'string' ? extracted.vendor_name : null;
    const rawDate = extracted.invoice_date ?? extracted.date ?? extracted.document_date ?? extracted.issue_date;
    let invoice_date: string | null = null;
    if (typeof rawDate === 'string' && rawDate.trim()) {
      const s = rawDate.trim();
      invoice_date = normalizeCalendarDateString(s);
      if (!invoice_date) {
        const named = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})$/);
        if (named) {
          invoice_date = calendarDateFromMonthNameDayYear(named[1], parseInt(named[2], 10), parseInt(named[3], 10));
        }
      }
    } else if (typeof rawDate === 'number' && rawDate > 0) {
      const d = new Date(rawDate);
      if (!Number.isNaN(d.getTime())) {
        invoice_date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      }
    }
    let subtotal = typeof extracted.subtotal === 'number' ? extracted.subtotal : (typeof extracted.subtotal === 'string' ? parseFloat(extracted.subtotal) : null);
    let total_amount = typeof extracted.total_amount === 'number' ? extracted.total_amount : (typeof extracted.total_amount === 'string' ? parseFloat(extracted.total_amount) : null);
    const totalAbsForNorm = total_amount != null && !Number.isNaN(total_amount) ? Math.abs(total_amount) : null;
    subtotal = normalizeExtractedAmount(subtotal, totalAbsForNorm);
    log("Parsed amounts from LLM", { subtotal, total_amount });

    // Regex/heuristic fallback — uses PDF/email text even for vision-only requests.
    let textFallback = extractInvoiceFieldsFromText(textForFallback);
    log("Text fallback extraction", textFallback);

    if (textForFallback) {
      if (!vendor_name && textFallback.vendor_name) vendor_name = textFallback.vendor_name;
      if (textFallback.total_amount != null && (total_amount == null || Math.abs(Math.abs(total_amount) - Math.abs(textFallback.total_amount)) > 0.02)) {
        total_amount = textFallback.total_amount;
      }
      if (textFallback.subtotal != null && (subtotal == null || Math.abs(Math.abs(subtotal) - Math.abs(textFallback.subtotal)) > 0.02)) {
        if (textFallback.total_amount == null || Math.abs(Math.abs(subtotal) - Math.abs(textFallback.total_amount)) < 0.02) {
          subtotal = textFallback.subtotal;
        }
      }
    }

    const reconciled = reconcileExtractedAmounts(
      { subtotal, total_amount, tax_amount: null },
      textFallback,
    );
    subtotal = reconciled.subtotal;
    total_amount = reconciled.total_amount;
    let tax_amount_early = reconciled.tax_amount;
    log("After text fallback reconcile (amounts)", { subtotal, total_amount, tax_amount: tax_amount_early });
    // Invoice number: priority 1) Invoice Number, 2) Order Number, 3) Reference Number
    const toStr = (v: unknown): string | null => {
      if (v == null) return null;
      if (typeof v === 'string') {
        const s = v.trim();
        return s === '' ? null : s;
      }
      if (typeof v === 'number' && !Number.isNaN(v)) return String(v);
      return null;
    };
    const invoice_number =
      toStr(extracted.invoice_number) ??
      toStr(extracted.invoice_no) ??
      toStr(extracted.order_number) ??
      toStr(extracted.order_id) ??
      toStr(extracted.reference_number) ??
      toStr(extracted.reference) ??
      textFallback.invoice_number ??
      null;
    if (!invoice_date && textFallback.invoice_date) invoice_date = textFallback.invoice_date;
    const rawCurrency = typeof extracted.invoice_currency === 'string' ? extracted.invoice_currency.trim().toUpperCase() : null;
    const invoice_currency = (rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : null)
      ?? textFallback.invoice_currency
      ?? 'CAD';
    const suggested_category_id = normalizeSuggestedCategoryId(extracted.suggested_category_id, categories);

    const line_items: Array<{ description: string | null; amount: number; tax_amount: number; suggested_category_id: string | null; gl_account_erpnext: string | null }> = [];
    const rawLines = extracted.line_items;
    if (Array.isArray(rawLines) && rawLines.length >= 2) {
      for (const item of rawLines) {
        if (!item || typeof item !== 'object') continue;
        const desc = typeof (item as { description?: unknown }).description === 'string' ? (item as { description: string }).description.trim() : null;
        const amtRaw = (item as { amount?: unknown }).amount;
        const amt = typeof amtRaw === 'number' ? amtRaw : (typeof amtRaw === 'string' ? parseFloat(amtRaw) : null);
        if (amt == null || Number.isNaN(amt) || amt === 0) continue;
        const taxRaw = (item as { tax_amount?: unknown }).tax_amount;
        const lineTax = typeof taxRaw === 'number' ? taxRaw : (typeof taxRaw === 'string' ? parseFloat(taxRaw) : 0);
        const catId = normalizeSuggestedCategoryId(
          (item as { suggested_category_id?: unknown }).suggested_category_id,
          categories
        );
        line_items.push({
          description: desc,
          amount: amt,
          tax_amount: Number.isNaN(lineTax) ? 0 : lineTax,
          suggested_category_id: catId,
          gl_account_erpnext: null
        });
      }
    }

    // Parse amount from breakdown item (number or string)
    const parseAmount = (item: unknown): number | null => {
      if (item == null || typeof item !== 'object') return null;
      const a = (item as { amount?: unknown }).amount;
      if (typeof a === 'number' && !Number.isNaN(a)) return a;
      if (typeof a === 'string') {
        const n = parseFloat(a);
        return Number.isNaN(n) ? null : n;
      }
      return null;
    };
    // From tax_breakdown: if HST (or GST/HST) is present, use ONLY that amount. Never use a combined total (HST+PST) which would double tax. HST is at most 13% of pre-tax; so cap at ~14% of total to reject combined amounts (e.g. 12.76).
    let tax_amount: number | null = tax_amount_early;
    let tax_source: string = "none";
    const rawBreakdown = extracted.tax_breakdown;
    if (Array.isArray(rawBreakdown) && rawBreakdown.length > 0) {
      log("tax_breakdown count", { count: rawBreakdown.length, items: (rawBreakdown as { label?: string; amount?: unknown }[]).map((i) => ({ label: i?.label, amount: i?.amount })) });
      const hstItems = rawBreakdown.filter((item: unknown) => typeof (item as { label?: string })?.label === 'string' && /hst/i.test((item as { label: string }).label));
      const hasHst = hstItems.length > 0;
      log("HST items filtered", { hasHst, hstCount: hstItems.length, hstLabels: (hstItems as { label?: string }[]).map((i) => i?.label) });
      if (hasHst) {
        let maxReasonableHst: number | null = null;
        if (total_amount != null && !Number.isNaN(total_amount)) {
          const absTotal = Math.abs(total_amount);
          const absSub = subtotal != null && !Number.isNaN(subtotal) ? Math.abs(subtotal) : 0;
          if (absSub > 0 && absTotal < absSub - 0.01) {
            maxReasonableHst = 0.14 * Math.max(absTotal, absSub * 1.2);
            log("HST cap (total < subtotal; using subtotal-based cap)", { total_amount, subtotal, maxReasonableHst });
          } else {
            maxReasonableHst = 0.14 * absTotal;
            log("HST cap", { total_amount, maxReasonableHst });
          }
        }
        const considered: { label?: string; amount: number; action: string }[] = [];
        let bestAmt: number | null = null;
        for (const item of hstItems) {
          const amt = parseAmount(item);
          const label = typeof (item as { label?: string })?.label === 'string' ? (item as { label: string }).label : undefined;
          if (amt == null) {
            considered.push({ label, amount: 0, action: "skip_null" });
            continue;
          }
          if (maxReasonableHst != null && Math.abs(amt) > maxReasonableHst) {
            considered.push({ label, amount: amt, action: "reject_over_cap" });
            continue;
          }
          considered.push({ label, amount: amt, action: "accept" });
          if (bestAmt == null || Math.abs(amt) > Math.abs(bestAmt)) bestAmt = amt;
        }
        log("HST decision per item", { considered, chosen: bestAmt });
        if (bestAmt != null) {
          tax_amount = bestAmt;
          tax_source = "hst_capped";
        }
      } else {
        let sum = 0;
        for (const item of rawBreakdown) {
          const amt = parseAmount(item);
          if (amt != null) sum += amt;
        }
        if (sum !== 0) {
          tax_amount = sum;
          tax_source = "sum_no_hst";
        }
        log("Tax from sum (no HST)", { tax_amount: sum });
      }
    }
    if (tax_amount == null) {
      const single = typeof extracted.tax_amount === 'number' ? extracted.tax_amount : (typeof extracted.tax_amount === 'string' ? parseFloat(extracted.tax_amount) : null);
      if (single != null && !Number.isNaN(single)) {
        const totalAbs = total_amount != null ? Math.abs(total_amount) : null;
        if (totalAbs == null || Math.abs(single) <= totalAbs * 0.18) {
          tax_amount = single;
          tax_source = "llm_single_tax";
        }
      }
      log("Tax fallback to LLM single", { single, tax_amount });
    }
    if (tax_amount == null && subtotal != null && total_amount != null && !Number.isNaN(subtotal) && !Number.isNaN(total_amount)) {
      const diff = Math.abs(total_amount) - Math.abs(subtotal);
      if (Math.abs(diff) >= 0.001) {
        tax_amount = total_amount < 0 ? -Math.abs(diff) : Math.abs(diff);
        tax_source = "derived_total_minus_subtotal";
      }
      log("Tax derived from total - subtotal", { tax_amount, subtotal, total_amount });
    }
    if (tax_amount == null && textFallback.tax_amount != null) {
      tax_amount = textFallback.tax_amount;
      tax_source = "text_fallback";
      log("Tax from text fallback", { tax_amount });
    }

    // If extracted total is less than subtotal, the "total" is likely a category/line total (e.g. 32.88), not the real invoice total. Derive total from subtotal + tax.
    let effectiveTotal = total_amount;
    if (subtotal != null && total_amount != null && tax_amount != null && !Number.isNaN(subtotal) && !Number.isNaN(total_amount) && !Number.isNaN(tax_amount)) {
      const absSub = Math.abs(subtotal);
      const absTotal = Math.abs(total_amount);
      if (absTotal < absSub - 0.01) {
        effectiveTotal = (subtotal < 0 && tax_amount < 0) ? subtotal + tax_amount : (subtotal + tax_amount);
        log("Total was smaller than subtotal (likely category total); derived total from subtotal + tax", { extracted_total: total_amount, subtotal, tax_amount, effectiveTotal });
      }
    }

    const subtotalBeforeDerive = subtotal;
    const totalAbsForDerive = effectiveTotal ?? total_amount;
    const taxAbsForDerive = tax_amount != null ? Math.abs(tax_amount) : null;
    const totalAbsNum = totalAbsForDerive != null ? Math.abs(totalAbsForDerive) : null;
    const taxLooksValid = taxAbsForDerive != null && totalAbsNum != null && taxAbsForDerive > 0 && taxAbsForDerive < totalAbsNum * 0.18;
    const subtotalDerived = taxLooksValid && totalAbsForDerive != null && tax_amount != null;
    if (subtotalDerived) {
      subtotal = (totalAbsForDerive as number) - (tax_amount as number);
      log("Subtotal set from total - tax", { subtotalBefore: subtotalBeforeDerive, subtotalAfter: subtotal, total_amount: effectiveTotal, tax_amount });
    } else {
      log("Subtotal NOT derived (missing total or tax)", { subtotal, total_amount: effectiveTotal, tax_amount });
    }

    if (
      textFallback.total_amount != null &&
      textFallback.tax_amount != null &&
      textFallback.subtotal != null &&
      Math.abs(Math.abs(textFallback.subtotal) + Math.abs(textFallback.tax_amount) - Math.abs(textFallback.total_amount)) < 0.05
    ) {
      total_amount = textFallback.total_amount;
      tax_amount = textFallback.tax_amount;
      subtotal = textFallback.subtotal;
      effectiveTotal = textFallback.total_amount;
      log("Using consistent text fallback amounts", { subtotal, tax_amount, total_amount });
    } else if (total_amount != null && tax_amount != null) {
      const t = Math.abs(normalizeExpenseAmount(total_amount) ?? 0);
      const tax = Math.abs(normalizeExpenseAmount(tax_amount) ?? 0);
      if (tax >= t * 0.18 && textFallback.tax_amount != null) {
        tax_amount = textFallback.tax_amount;
        if (textFallback.subtotal != null) subtotal = textFallback.subtotal;
        else subtotal = normalizeExpenseAmount(t - Math.abs(textFallback.tax_amount));
      } else if (subtotal != null && Math.abs(Math.abs(subtotal) - t) < 0.02 && tax > 0 && tax < t * 0.18) {
        subtotal = normalizeExpenseAmount(t - tax);
      }
    }

    if (total_amount != null && subtotal != null) {
      const t = Math.abs(normalizeExpenseAmount(total_amount) ?? 0);
      const s = Math.abs(normalizeExpenseAmount(subtotal) ?? 0);
      const taxNow = tax_amount != null ? Math.abs(normalizeExpenseAmount(tax_amount) ?? 0) : 0;
      const impliedTax = Math.round((t - s) * 100) / 100;
      if (impliedTax >= 0.01 && impliedTax < t * 0.18 && (taxNow < 0.01 || taxNow >= t * 0.18)) {
        tax_amount = normalizeExpenseAmount(-impliedTax);
        log("Derived tax from total - subtotal (final)", { tax_amount, total_amount, subtotal });
      }
    }

    log("EXIT CHOSEN", {
      vendor_name,
      invoice_date,
      total_amount: effectiveTotal ?? total_amount,
      tax_amount,
      tax_source,
      subtotal,
      subtotal_derived: subtotalDerived,
      suggested_category_id
    });

    const creditMemo = applyCreditMemoExtraction(textForFallback, {
      vendor_name,
      invoice_number,
      subtotal,
      tax_amount,
      total_amount: effectiveTotal ?? total_amount,
    });
    if (creditMemo.document_type === "credit_memo") {
      vendor_name = creditMemo.vendor_name;
      invoice_number = creditMemo.invoice_number;
      subtotal = creditMemo.subtotal;
      tax_amount = creditMemo.tax_amount;
      effectiveTotal = creditMemo.total_amount;
      total_amount = creditMemo.total_amount;
      log("Credit memo detected", creditMemo);
    }

    const finalized = finalizeExpenseAmounts({
      subtotal: subtotal != null && !Number.isNaN(subtotal) ? subtotal : null,
      tax_amount: tax_amount != null && !Number.isNaN(tax_amount) ? tax_amount : null,
      total_amount: (() => {
        const t = effectiveTotal ?? total_amount;
        return t != null && !Number.isNaN(Number(t)) ? Number(t) : null;
      })(),
    });

    return json({
      vendor_name: vendor_name || null,
      invoice_date: invoice_date || null,
      subtotal: finalized.subtotal,
      tax_amount: finalized.tax_amount,
      total_amount: finalized.total_amount,
      invoice_number: invoice_number || null,
      invoice_currency: invoice_currency || 'CAD',
      suggested_category_id: suggested_category_id || null,
      line_items: line_items.length >= 2 ? line_items : [],
      document_type: creditMemo.document_type,
      credit_memo_against: creditMemo.credit_memo_against,
    });
  } catch (e) {
    console.error("[extract-invoice] FATAL", e);
    return corsResponse(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), 500);
  }
});
