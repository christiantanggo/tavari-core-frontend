import { extractForwardedReceiptSection } from "./emailBodyNormalize.ts";
import { parseWonderlandShippedTotal } from "./invoiceDocumentDetect.ts";
import { calendarDateFromMonthNameDayYear, normalizeCalendarDateString } from "./businessDayWindow.ts";

export type InvoiceTextFallback = {
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_currency: string | null;
  subtotal: number | null;
  total_amount: number | null;
  tax_amount: number | null;
};

const num = (s: string): number => {
  const n = parseFloat(s.replace(/,/g, "").trim());
  return typeof n === "number" && !Number.isNaN(n) ? n : NaN;
};

const negExpense = (v: number) => -Math.abs(v);

function parseInvoiceDateFromSlice(text: string): string | null {
  if (!text?.trim()) return null;

  const datePaid = text.match(
    /Date paid\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})/i,
  );
  if (datePaid) {
    return calendarDateFromMonthNameDayYear(datePaid[1], parseInt(datePaid[2], 10), parseInt(datePaid[3], 10));
  }

  const invoiceDateLabel = text.match(
    /Invoice\s+Date\s*[:\s]+(?:([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})|(\d{4}-\d{2}-\d{2}))/i,
  );
  if (invoiceDateLabel) {
    if (invoiceDateLabel[4]) return invoiceDateLabel[4];
    return calendarDateFromMonthNameDayYear(invoiceDateLabel[1], parseInt(invoiceDateLabel[2], 10), parseInt(invoiceDateLabel[3], 10));
  }

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (/^(From|To|Cc|Subject|Sent|Date|Reply-To):/i.test(line)) continue;
    if (/\b(?:effective|minimum|delivery charge|restocking|interest per month)\b/i.test(line)) continue;

    const monthDay = line.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})\b/i,
    );
    if (monthDay) {
      return calendarDateFromMonthNameDayYear(monthDay[1], parseInt(monthDay[2], 10), parseInt(monthDay[3], 10));
    }

    const long = line.match(
      /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})\b/i,
    );
    if (long) {
      return calendarDateFromMonthNameDayYear(long[1], parseInt(long[2], 10), parseInt(long[3], 10));
    }

    const iso = line.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (iso) return iso[1];
  }

  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  return null;
}

function parseInvoiceDate(text: string): string | null {
  const invoiceDateExplicit = text.match(
    /INVOICE\s+DATE\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})/i,
  );
  if (invoiceDateExplicit) {
    return calendarDateFromMonthNameDayYear(invoiceDateExplicit[1], parseInt(invoiceDateExplicit[2], 10), parseInt(invoiceDateExplicit[3], 10));
  }

  const receiptSection = extractForwardedReceiptSection(text);
  return parseInvoiceDateFromSlice(receiptSection) || parseInvoiceDateFromSlice(text);
}

function parseVendorName(text: string): string | null {
  if (/Wonderland\s+Food\s*&\s*Equipment/i.test(text)) return "Wonderland Food & Equipment";
  if (/\bRogers\b/i.test(text) && /(?:rci\.rogers|myrogers|your bill is)/i.test(text)) return "Rogers";
  const receiptFrom = text.match(
    /Receipt from\s+([A-Z0-9][A-Za-z0-9&.'\- ]{1,80}?)\s*(?:\[#|\[|\.|,|$)/i,
  );
  if (receiptFrom?.[1]) {
    const name = receiptFrom[1].replace(/\s+/g, " ").trim();
    if (!/^(the|your)$/i.test(name)) return name;
  }
  const quotedFrom = text.match(/From:\s*"([^"]{3,80})"/i);
  if (quotedFrom?.[1] && !/(fournier|christian|offthewall|outlook|gmail)/i.test(quotedFrom[1])) {
    return quotedFrom[1].replace(/\s+/g, " ").trim();
  }
  const soldToIdx = text.search(/\bS\s*O\s*L\s*D\s+T\s*O\b/i);
  const header = soldToIdx > 40 ? text.slice(0, soldToIdx) : text.slice(0, 800);
  if (!/Wonderland/i.test(header)) {
    const vendorMatch = header.match(
      /([A-Z][A-Za-z0-9&.'\- ]{4,80}?)\s+\d{3,6}\s+[A-Za-z0-9 .,'-]{5,40}\s+(?:Mississauga|Toronto|London|ON|QC|BC|AB|Canada)/i,
    );
    if (vendorMatch?.[1] && !/SHIP\s*TO|OffTheWall|Off The Wall/i.test(vendorMatch[1])) {
      return vendorMatch[1].replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

/** Rogers bill-ready emails: Current bill + (including $X HST). Avoid mixing net credit with monthly charges. */
function parseRogersBillSummary(text: string): Pick<InvoiceTextFallback, "subtotal" | "total_amount" | "tax_amount"> | null {
  if (!/\bRogers\b/i.test(text) || !/your bill (?:is|total)/i.test(text)) return null;

  const hstIncluded = text.match(/\(including\s+\$?\s*([\d,]+\.\d{2})\s+HST\)/i);
  const currentBill = text.match(/Current bill:\s*\$?\s*([\d,]+\.\d{2})/i);
  const billTotalNeg = text.match(/Your bill total:\s*-\$?\s*([\d,]+\.\d{2})/i);
  const billTotalPos = text.match(/Your bill total:\s*(?<!\-)\$?\s*([\d,]+\.\d{2})/i);

  const taxV = hstIncluded ? num(hstIncluded[1]) : NaN;
  const taxAbs = !Number.isNaN(taxV) && taxV > 0 ? taxV : null;

  let totalAbs: number | null = null;
  if (currentBill) {
    const v = num(currentBill[1]);
    if (!Number.isNaN(v) && v > 0) totalAbs = v;
  }
  if (totalAbs == null && billTotalPos) {
    const v = num(billTotalPos[1]);
    if (!Number.isNaN(v) && v > 0) totalAbs = v;
  }
  if (totalAbs == null && billTotalNeg) {
    const v = num(billTotalNeg[1]);
    if (!Number.isNaN(v) && v > 0) totalAbs = v;
  }
  if (totalAbs == null) return null;

  const tax_amount = taxAbs != null ? negExpense(taxAbs) : null;
  const total_amount = negExpense(totalAbs);
  const subtotal = taxAbs != null
    ? negExpense(Math.round((totalAbs - taxAbs) * 100) / 100)
    : negExpense(totalAbs);

  return { subtotal, total_amount, tax_amount };
}

function parseInvoiceCurrency(text: string): string | null {
  if (/\b(?:amounts are (?:all )?(?:expressed )?in|expressed in|currency[:\s]+)\s*USD\b/i.test(text)) return "USD";
  if (/\b(?:amounts are (?:all )?(?:expressed )?in|expressed in|currency[:\s]+)\s*(?:CAD|CDN|Canadian dollars?)\b/i.test(text)) return "CAD";
  if (/\bUS\s*D\b|\bUSD\b|\$\s*USD/i.test(text) && !/\bCAD\b|\bCDN\b/i.test(text)) return "USD";
  if (/\bCAD\b|\bCDN\b|Canadian dollars?/i.test(text)) return "CAD";
  return null;
}

function parseInvoiceNumber(text: string): string | null {
  const patterns = [
    /receipt\s*\[#?\s*([0-9]+-[0-9]+)\]/i,
    /receipt\s*#\s*([0-9]+-[0-9]+)/i,
    /\[#([0-9]+-[0-9]+)\]/i,
    /(\d{5,})INVOICE\s*#/i,
    /(\d{5,})\s+INVOICE\s+#/i,
    /INVOICE\s+#\s*(\d{4,})/i,
    /INVOICE\s+(?:NO\.?|NUMBER|#)\s*[:\s]*(\d{4,})/i,
    /Order\s*ID\s*[:\s#]*(\d{4,})/i,
    /Order\s*(?:No\.?|Number|#)\s*[:\s#]*(\d{4,})/i,
    /Receipt\s*(?:No\.?|Number|#)\s*[:\s#]*(\d{4,})/i,
    /Confirmation\s*(?:No\.?|Number|#)\s*[:\s#]*(\d{4,})/i,
    /Transaction\s*(?:ID|No\.?|Number|#)\s*[:\s#]*(\d{4,})/i,
    /Reference\s*(?:No\.?|Number|#)\s*[:\s#]*(\d{4,})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/** Regex/heuristic extraction when LLM misses fields or PDF text is messy. Amounts are negative for expenses. */
export function extractInvoiceFieldsFromText(invoiceText: string): InvoiceTextFallback {
  const result: InvoiceTextFallback = {
    vendor_name: null,
    invoice_number: null,
    invoice_date: null,
    invoice_currency: null,
    subtotal: null,
    total_amount: null,
    tax_amount: null,
  };
  if (!invoiceText?.trim()) return result;

  const text = invoiceText.replace(/\s+/g, " ");
  const lines = invoiceText.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

  result.vendor_name = parseVendorName(text);
  result.invoice_number = parseInvoiceNumber(text);
  result.invoice_date = parseInvoiceDate(text);
  result.invoice_currency = parseInvoiceCurrency(text);

  const rogersSummary = parseRogersBillSummary(text);
  if (rogersSummary) {
    result.subtotal = rogersSummary.subtotal;
    result.total_amount = rogersSummary.total_amount;
    result.tax_amount = rogersSummary.tax_amount;
    return finalizeExpenseAmounts(result);
  }

  const totalDue = text.match(/TOTAL\s+DUE\s*\$?\s*([\d,]+\.\d{2})/i);
  if (totalDue) {
    const v = num(totalDue[1]);
    if (!Number.isNaN(v)) result.total_amount = negExpense(v);
  }
  if (result.total_amount == null) {
    const amountPaid = text.match(/Amount paid\s+(?:CA?\$|C?\$)\s*([\d,]+\.\d{2})/i);
    if (amountPaid) {
      const v = num(amountPaid[1]);
      if (!Number.isNaN(v)) result.total_amount = negExpense(v);
    }
  }
  if (result.total_amount == null) {
    const charged = text.match(/(?:has\s+been\s+charged|charged\s+to\s+your\s+payment)[^$\d]{0,40}\$?\s*([\d,]+\.\d{2})/i);
    if (charged) {
      const v = num(charged[1]);
      if (!Number.isNaN(v)) result.total_amount = negExpense(v);
    }
  }
  if (result.total_amount == null && isPaymentConfirmationDocument(text)) {
    const invoiceAmt = text.match(/Invoice\s+No\.?\s*[^\d]{0,20}\$?\s*([\d,]+\.\d{2})/i);
    if (invoiceAmt) {
      const v = num(invoiceAmt[1]);
      if (!Number.isNaN(v)) result.total_amount = negExpense(v);
    }
  }

  if (result.total_amount == null) {
    const totalCharged = text.match(/TOTAL\s+CHARGED\s*[:\s]*\$?\s*([\d,]+\.\d{2})/i);
    if (totalCharged) {
      const v = num(totalCharged[1]);
      if (!Number.isNaN(v)) result.total_amount = negExpense(v);
    }
  }

  if (result.total_amount == null) {
    const balanceDue = text.match(/(?:BALANCE\s+DUE|NET\s+AMOUNT|INVOICE\s+TOTAL)\s*[:\$]?\s*([\d,]+\.\d{2})/i);
    if (balanceDue) {
      const v = num(balanceDue[1]);
      if (!Number.isNaN(v)) result.total_amount = negExpense(v);
    }
  }

  if (result.total_amount == null) {
    const allTotals: number[] = [];
    const totalPhrases = /ORDER\s+TOTAL|TOTAL\s+COMMANDE|TOTAL\s+CHARGED|Amount\s+Due|Amount\s+paid|invoice\s+total|grand\s+total|total\s+due|balance\s+due|net\s+amount/i;
    for (const line of lines) {
      if (totalPhrases.test(line)) {
        const m = line.match(/[:\$]?\s*([\d,]+\.\d{2})/);
        if (m) {
          const v = num(m[1]);
          if (!Number.isNaN(v)) allTotals.push(v);
        }
      }
    }
    if (allTotals.length === 0) {
      const m = text.match(/TOTAL\s+DUE\s*\$?\s*([\d,]+\.\d{2})/i);
      if (m) {
        const v = num(m[1]);
        if (!Number.isNaN(v)) allTotals.push(v);
      }
    }
    if (allTotals.length > 0) result.total_amount = negExpense(Math.max(...allTotals));
  }

  const wonderlandAmounts = parseWonderlandShippedTotal(text);
  if (wonderlandAmounts) {
    const totalAbs = result.total_amount != null ? Math.abs(result.total_amount) : null;
    if (totalAbs == null || Math.abs(totalAbs - Math.abs(wonderlandAmounts.total_amount)) < 0.05) {
      result.total_amount = wonderlandAmounts.total_amount;
      result.tax_amount = wonderlandAmounts.tax_amount;
      result.subtotal = wonderlandAmounts.subtotal;
    }
  }

  const totalAbsForTax = result.total_amount != null ? Math.abs(result.total_amount) : null;
  const hstLine = lines.find((l) => /(?:GST\/?HST|HST)\s+(?:TOTAL|#)/i.test(l));
  if (hstLine && result.tax_amount == null) {
    const m = hstLine.match(/[:\$]?\s*([\d,]+\.\d{2})/);
    if (m) {
      const v = num(m[1]);
      if (!Number.isNaN(v) && (totalAbsForTax == null || (v > 0 && v < totalAbsForTax * 0.2))) {
        result.tax_amount = negExpense(v);
      }
    }
  }
  if (result.tax_amount == null) {
    const stripeHst = text.match(/HST[^$\d]{0,40}(?:CA?\$|C?\$)\s*([\d,]+\.\d{2})/i);
    if (stripeHst) {
      const v = num(stripeHst[1]);
      if (!Number.isNaN(v)) result.tax_amount = negExpense(v);
    }
  }
  if (result.tax_amount == null) {
    const totalAbs = result.total_amount != null ? Math.abs(result.total_amount) : null;
    const hstMatches = [...text.matchAll(/(?:GST\/?HST|HST)\s+#?\s*\$?\s*([\d,]+\.\d{2})/gi)];
    for (const m of hstMatches) {
      const v = num(m[1]);
      if (Number.isNaN(v)) continue;
      if (totalAbs != null && Math.abs(v - totalAbs) < 0.01) continue;
      if (totalAbs != null && v > totalAbs * 0.18) continue;
      result.tax_amount = negExpense(v);
      break;
    }
  }
  if (result.tax_amount == null) {
    const shippedTax = text.match(/#\s*SHIPPED\s+TOTAL\s+\$?([\d,]+\.\d{2})\s+\d+\s+([\d,]+\.\d{2})/i);
    if (shippedTax) {
      const v = num(shippedTax[2]);
      if (!Number.isNaN(v)) result.tax_amount = negExpense(v);
    }
  }

  const invSubLine = lines.find((l) => /INV\s+SUB-?\s*TOTAL\s+BEFORE\s+TAXES?|SUB-?\s*TOTAL\s+BEFORE\s+TAXES?/i.test(l));
  if (invSubLine) {
    const m = invSubLine.match(/[:\$]?\s*([\d,]+\.\d{2})/);
    if (m) {
      const v = num(m[1]);
      if (!Number.isNaN(v)) result.subtotal = negExpense(v);
    }
  }
  if (result.subtotal == null) {
    const stripeSub = text.match(/Subtotal\s+(?:CA?\$|C?\$)\s*([\d,]+\.\d{2})/i);
    if (stripeSub) {
      const v = num(stripeSub[1]);
      if (!Number.isNaN(v)) result.subtotal = negExpense(v);
    }
  }
  if (result.subtotal == null) {
    const subLine = lines.find((l) => /\bSUB-?\s*TOTAL\b/i.test(l) && !/BEFORE\s+TAX/i.test(l));
    if (subLine) {
      const m = subLine.match(/[:\$]?\s*([\d,]+\.\d{2})/);
      if (m) {
        const v = num(m[1]);
        const totalAbs = result.total_amount != null ? Math.abs(result.total_amount) : null;
        if (!Number.isNaN(v) && (totalAbs == null || (v > 0 && v < totalAbs * 0.99))) {
          result.subtotal = negExpense(v);
        }
      }
    }
  }
  if (result.subtotal == null) {
    const eachLine = text.match(/\bEach\s+([\d,]+\.\d{2})\s+\1\b/i);
    if (eachLine) {
      const v = num(eachLine[1]);
      if (!Number.isNaN(v)) result.subtotal = negExpense(v);
    }
  }

  if (result.tax_amount == null && result.total_amount != null) {
    const totalAbs = Math.abs(result.total_amount);
    const shippedTaxMatch = text.match(/#\s*SHIPPED\s+TOTAL\s+\$?\s*[\d,]+\.\d{2}\s+\d+\s+([\d,]+\.\d{2})/i);
    if (shippedTaxMatch) {
      const v = num(shippedTaxMatch[1]);
      if (!Number.isNaN(v) && v > 0 && v < totalAbs * 0.18) {
        result.tax_amount = negExpense(v);
      }
    }
  }

  const paymentConfirmationOnly = isPaymentConfirmationDocument(text) && !hasExplicitTaxBreakdown(text);
  if (!paymentConfirmationOnly && result.tax_amount == null && result.total_amount != null) {
    const totalAbs = Math.abs(result.total_amount);
    const amounts = [...text.matchAll(/\b(\d+\.\d{2})\b/g)]
      .map((m) => parseFloat(m[1]))
      .filter((v) => !Number.isNaN(v) && v > 0 && v < totalAbs);
    for (const cand of amounts) {
      const sub = Math.round((totalAbs - cand) * 100) / 100;
      if (sub <= 0) continue;
      const rate = cand / sub;
      if (Math.abs(rate - 0.13) <= 0.015 || Math.abs(rate - 0.05) <= 0.008 || Math.abs(rate - 0.15) <= 0.02) {
        result.tax_amount = negExpense(cand);
        if (result.subtotal == null) result.subtotal = negExpense(sub);
        break;
      }
    }
  }

  if (result.subtotal == null && result.total_amount != null) {
    const totalAbs = Math.abs(result.total_amount);
    const backSub = Math.round((totalAbs / 1.13) * 100) / 100;
    const backTax = Math.round((totalAbs - backSub) * 100) / 100;
    if (backSub > 0 && backTax > 0 && Math.abs(backSub + backTax - totalAbs) < 0.02) {
      result.subtotal = negExpense(backSub);
      if (result.tax_amount == null) result.tax_amount = negExpense(backTax);
    }
  }

  return finalizeExpenseAmounts(result, {
    singleTotalNoTax: paymentConfirmationOnly,
  });
}

export type ExpenseAmounts = {
  subtotal: number | null;
  tax_amount: number | null;
  total_amount: number | null;
};

export type FinalizeExpenseAmountsOptions = {
  /** Payment confirmations / foreign receipts with no tax lines — do not invent 13% HST. */
  singleTotalNoTax?: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Payment receipt / confirmation emails often show only a charged amount, not a tax breakdown. */
export function isPaymentConfirmationDocument(text: string, subject?: string | null): boolean {
  const hay = `${subject || ""}\n${text || ""}`.trim();
  if (!hay) return false;
  return /payment\s+received|has\s+been\s+paid|has\s+been\s+charged|payment\s+confirmation|your\s+receipt\s+from|thank\s+you\s+for\s+your\s+payment/i.test(hay);
}

/** True when the document text shows an explicit tax/subtotal breakdown (not inferred). */
export function hasExplicitTaxBreakdown(text: string): boolean {
  if (!text?.trim()) return false;
  return /(?:GST\/?HST|HST)\s*(?:TOTAL|#|:|\$)|\bSUB-?\s*TOTAL\b|subtotal\s+(?:CA?\$|C?\$|USD?\$)/i.test(text);
}

/**
 * Final reconciliation for expense amounts — used by text fallback, LLM merge, and draft save.
 * Normalizes invalid zeros, derives missing subtotal/tax from total (incl. 13% HST split).
 */
export function finalizeExpenseAmounts(
  raw: ExpenseAmounts,
  options: FinalizeExpenseAmountsOptions = {},
): ExpenseAmounts {
  let total_amount = raw.total_amount;
  const totalAbs = total_amount != null && !Number.isNaN(Number(total_amount))
    ? Math.abs(Number(total_amount))
    : null;

  let subtotal = normalizeExtractedAmount(raw.subtotal, totalAbs);
  let tax_amount = normalizeExtractedAmount(raw.tax_amount, totalAbs);

  if (totalAbs != null && tax_amount != null && subtotal == null) {
    subtotal = negExpense(totalAbs - Math.abs(tax_amount));
  }
  if (totalAbs != null && subtotal != null && tax_amount == null) {
    const implied = round2(totalAbs - Math.abs(subtotal));
    if (implied >= 0.01 && implied < totalAbs * 0.2) tax_amount = negExpense(implied);
  }
  if (totalAbs != null && subtotal == null && tax_amount == null) {
    if (options.singleTotalNoTax) {
      subtotal = negExpense(totalAbs);
      tax_amount = null;
    } else {
      const backSub = round2(totalAbs / 1.13);
      const backTax = round2(totalAbs - backSub);
      if (backSub > 0 && backTax > 0 && Math.abs(backSub + backTax - totalAbs) < 0.02) {
        subtotal = negExpense(backSub);
        tax_amount = negExpense(backTax);
      }
    }
  }

  if (options.singleTotalNoTax && totalAbs != null) {
    subtotal = negExpense(totalAbs);
    tax_amount = null;
  }

  if (totalAbs != null && subtotal != null && tax_amount != null) {
    const s = Math.abs(subtotal);
    const t = Math.abs(tax_amount);
    if (Math.abs(s + t - totalAbs) > 0.02 && Math.abs(s - totalAbs) < 0.02 && t > 0.01) {
      subtotal = negExpense(totalAbs - t);
    }
  }

  return {
    subtotal: subtotal != null ? normalizeExpenseAmount(subtotal) : null,
    tax_amount: tax_amount != null && Math.abs(Number(tax_amount)) >= 0.01
      ? normalizeExpenseAmount(tax_amount)
      : null,
    total_amount: total_amount != null ? normalizeExpenseAmount(total_amount) : null,
  };
}

/** True when total is present but subtotal/tax are missing — triggers email/PDF fallback paths. */
export function isExpenseAmountsIncomplete(amounts: ExpenseAmounts): boolean {
  const totalAbs = amounts.total_amount != null ? Math.abs(Number(amounts.total_amount)) : 0;
  if (totalAbs < 0.01) return true;
  const subAbs = amounts.subtotal != null ? Math.abs(Number(amounts.subtotal)) : 0;
  const taxAbs = amounts.tax_amount != null ? Math.abs(Number(amounts.tax_amount)) : 0;
  if (subAbs < 0.01) return true;
  if (taxAbs < 0.01 && Math.abs(subAbs - totalAbs) > 0.02) return true;
  if (Math.abs(subAbs + taxAbs - totalAbs) > 0.05) return true;
  return false;
}

/** Treat 0 or total-sized tax/subtotal as missing so fallbacks can fill in. */
export function normalizeExtractedAmount(
  value: number | null | undefined,
  totalAbs: number | null,
): number | null {
  if (value == null || Number.isNaN(Number(value))) return null;
  const abs = Math.abs(Number(value));
  if (abs < 0.01) return null;
  if (totalAbs != null && abs >= totalAbs * 0.95) return null;
  return Number(value);
}

/** Prefer fallback when LLM amount is missing or clearly wrong (e.g. subtotal equals total but tax exists in text). */
export function reconcileExtractedAmounts(
  llm: { subtotal: number | null; total_amount: number | null; tax_amount: number | null },
  fallback: InvoiceTextFallback,
): { subtotal: number | null; total_amount: number | null; tax_amount: number | null } {
  const totalAbsEarly = llm.total_amount != null ? Math.abs(llm.total_amount) : null;
  let subtotal = normalizeExtractedAmount(llm.subtotal, totalAbsEarly);
  let total_amount = llm.total_amount;
  let tax_amount = normalizeExtractedAmount(llm.tax_amount, totalAbsEarly);

  if (total_amount == null && fallback.total_amount != null) total_amount = fallback.total_amount;
  if (tax_amount == null && fallback.tax_amount != null) tax_amount = fallback.tax_amount;
  if (subtotal == null && fallback.subtotal != null) subtotal = fallback.subtotal;

  const totalAbs = total_amount != null ? Math.abs(total_amount) : null;
  const subAbs = subtotal != null ? Math.abs(subtotal) : null;
  const taxAbs = tax_amount != null ? Math.abs(tax_amount) : null;

  if (totalAbs != null && taxAbs != null && subAbs != null && Math.abs(subAbs - totalAbs) < 0.01 && taxAbs > 0.01) {
    subtotal = fallback.subtotal ?? negExpense(totalAbs - taxAbs);
  }
  if (totalAbs != null && taxAbs != null && subAbs == null) {
    subtotal = negExpense(totalAbs - taxAbs);
  }
  if (totalAbs != null && taxAbs == null && subAbs != null && subAbs < totalAbs - 0.01) {
    tax_amount = negExpense(totalAbs - subAbs);
  }

  if (fallback.subtotal != null && subtotal != null && Math.abs(Math.abs(subtotal) - Math.abs(fallback.subtotal)) > 0.02) {
    if (fallback.total_amount != null && Math.abs(Math.abs(subtotal) - Math.abs(fallback.total_amount)) < 0.02) {
      subtotal = fallback.subtotal;
    }
  }

  return finalizeExpenseAmounts({ subtotal, total_amount, tax_amount });
}

export function normalizeExpenseAmount(value: number | null): number | null {
  if (value == null || Number.isNaN(value) || value === 0) return value;
  return value > 0 ? -Math.abs(value) : value;
}

/** True when extraction lacks usable totals or picked up email/header noise as vendor. */
export function isWeakExtraction(ex: {
  vendor_name?: string | null;
  subtotal?: number | null;
  tax_amount?: number | null;
  total_amount?: number | null;
}): boolean {
  const total = ex.total_amount != null ? Math.abs(Number(ex.total_amount)) : 0;
  if (total < 0.01) return true;
  if (isExpenseAmountsIncomplete({
    subtotal: ex.subtotal ?? null,
    tax_amount: ex.tax_amount ?? null,
    total_amount: ex.total_amount ?? null,
  })) return true;
  const vendor = (ex.vendor_name || "").toLowerCase();
  if (/(fournier|christian|chriastian|forward|iphone|outlook\.com|ship\s*to)/i.test(vendor)) return true;
  return false;
}

/** Retry / success gate: non-zero total with consistent subtotal + tax. */
export function extractionGotValidData(amounts: ExpenseAmounts): boolean {
  const total = amounts.total_amount != null ? Math.abs(Number(amounts.total_amount)) : 0;
  if (total < 0.01) return false;
  return !isExpenseAmountsIncomplete(amounts);
}

/** Infer HST treatment from extracted amounts when vendor/category defaults are not set. */
export function inferHstTreatmentFromAmounts(
  tax_amount: number | null | undefined,
  subtotal: number | null | undefined,
  total_amount: number | null | undefined,
  documentText?: string | null,
): "exempt" | "recoverable" | "included" | null {
  if (documentText && /\(including\s+\$?[\d,]+\.\d{2}\s+HST\)/i.test(documentText)) {
    return "included";
  }
  const taxAbs = tax_amount != null && !Number.isNaN(Number(tax_amount)) ? Math.abs(Number(tax_amount)) : 0;
  const totalAbs = total_amount != null && !Number.isNaN(Number(total_amount)) ? Math.abs(Number(total_amount)) : null;
  const subAbs = subtotal != null && !Number.isNaN(Number(subtotal)) ? Math.abs(Number(subtotal)) : null;

  if (taxAbs >= 0.01) return "recoverable";
  if (totalAbs == null || totalAbs <= 0) return null;
  if (subAbs == null || Math.abs(subAbs - totalAbs) < 0.02) return "exempt";
  return null;
}

/** Posting / manual edits: derive a consistent subtotal + tax from total (total wins). */
export function reconcileDraftExpenseAmountsForPosting(
  amounts: ExpenseAmounts & { hst_treatment?: string | null },
): { totalAbs: number; subtotalAbs: number; taxAbs: number } {
  const totalAbs = Math.abs(Number(amounts.total_amount) || 0);
  const treatment = String(amounts.hst_treatment || "recoverable").trim().toLowerCase();

  if (treatment === "exempt") {
    return { totalAbs, subtotalAbs: totalAbs, taxAbs: 0 };
  }

  let taxAbs = Math.abs(Number(amounts.tax_amount) || 0);
  if (taxAbs > totalAbs) taxAbs = 0;
  return {
    totalAbs,
    subtotalAbs: round2(totalAbs - taxAbs),
    taxAbs,
  };
}

/** Same amount resolution as accounting-post-expense (CAD settlement for foreign invoices). */
export function resolveDraftPostingAmounts(draft: {
  subtotal?: unknown;
  tax_amount?: unknown;
  total_amount?: unknown;
  hst_treatment?: unknown;
  invoice_currency?: unknown;
  cad_settlement_total?: unknown;
}): { totalAbs: number; subtotalAbs: number; taxAbs: number; usedCadSettlement: boolean } {
  const invoiceCurrency = String(draft.invoice_currency || "CAD").trim().toUpperCase() || "CAD";
  const cadSettlement = draft.cad_settlement_total != null && !Number.isNaN(Number(draft.cad_settlement_total))
    ? Math.abs(Number(draft.cad_settlement_total))
    : null;
  const useCadSettlement = invoiceCurrency !== "CAD" && cadSettlement != null && cadSettlement > 0;
  const hstTreatment = String(draft.hst_treatment || "recoverable").trim().toLowerCase();

  const reconciled = reconcileDraftExpenseAmountsForPosting({
    subtotal: useCadSettlement ? cadSettlement : draft.subtotal,
    tax_amount: useCadSettlement ? 0 : draft.tax_amount,
    total_amount: useCadSettlement ? cadSettlement : draft.total_amount,
    hst_treatment: useCadSettlement ? "exempt" : hstTreatment,
  });

  return { ...reconciled, usedCadSettlement: useCadSettlement };
}
