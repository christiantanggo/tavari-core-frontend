/** Detect vendor credit memos and parse amounts from common Canadian supplier PDF layouts. */

export type ExpenseDocumentType = "invoice" | "credit_memo";

const num = (s: string): number => {
  const n = parseFloat(s.replace(/,/g, "").trim());
  return typeof n === "number" && !Number.isNaN(n) ? n : NaN;
};

const negExpense = (v: number) => -Math.abs(v);

export function detectCreditMemoFromText(text: string): boolean {
  if (!text?.trim()) return false;
  if (/<<\s*CREDIT\s*MEM|credit\s*memo\b|credit\s*note\b|debit\s*note\b/i.test(text)) return true;
  if (/reversal\s+of/i.test(text) && /\$\s*[\d,]+\.\d{2}/i.test(text)) return true;
  if (/\breturn(?:ed|s)?\s+receipt\b/i.test(text)) return true;
  if (/\breturn\s+transaction\b/i.test(text)) return true;
  if (/\brefund(?:ed|s)?\b/i.test(text) && /\$\s*[\d,]+\.\d{2}/i.test(text)) return true;
  if (/\bhome\s*depot\b/i.test(text) && /\breturn\b/i.test(text)) return true;
  if (/\bvendor\s+return\b/i.test(text)) return true;
  return false;
}

export function parseCreditMemoReferences(text: string): {
  order_number: string | null;
  original_invoice_number: string | null;
} {
  if (!text?.trim()) return { order_number: null, original_invoice_number: null };

  const orderMatch = text.match(/\bORDER\s*#\s*(\d{4,})/i);
  const order_number = orderMatch?.[1]?.trim() || null;

  let original_invoice_number: string | null = null;
  const origBlock = text.match(/ORIGINAL\s+INVOICE[\s\S]{0,80}?(\d{4,})/i);
  if (origBlock?.[1]) original_invoice_number = origBlock[1].trim();
  if (!original_invoice_number) {
    const noLine = text.match(/\b(\d{5,})\s+NO\b/i);
    if (noLine?.[1]) original_invoice_number = noLine[1].trim();
  }

  return { order_number, original_invoice_number };
}

/** Columnar supplier PDFs (Wonderland / WF&E): # SHIPPED TOTAL row, spaced or mashed columns. */
export function parseWonderlandShippedTotal(text: string): {
  subtotal: number;
  tax_amount: number;
  total_amount: number;
} | null {
  if (!text?.trim()) return null;

  const spaced = text.match(
    /#\s*SHIPPED\s+TOTAL\s+\$?\s*([\d,]+\.\d{2})\s+\d+\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/i,
  );
  if (spaced) {
    const total = num(spaced[1]);
    const tax = num(spaced[2]);
    const sub = num(spaced[3]);
    if (!Number.isNaN(total) && !Number.isNaN(tax) && total > 0 && tax > 0 && tax < total * 0.2) {
      const useSub = !Number.isNaN(sub) && sub > 0 ? sub : Math.round((total - tax) * 100) / 100;
      return {
        total_amount: negExpense(total),
        tax_amount: negExpense(tax),
        subtotal: negExpense(useSub),
      };
    }
  }

  // PDF text often mashes columns: "# SHIPPED TOTAL $554.526 63.790.00" ($554.52 + unit count 6)
  const mashed = text.match(
    /#\s*SHIPPED\s+TOTAL\s+\$?\s*([\d,]+)\.(\d{2})(\d)\s+([\d,]+\.\d{2})(?:\s+([\d,]+\.\d{2}))?/i,
  );
  if (mashed) {
    const total = num(`${mashed[1]}.${mashed[2]}`);
    const tax = num(mashed[4]);
    const trailing = mashed[5] ? num(mashed[5]) : NaN;
    if (!Number.isNaN(total) && !Number.isNaN(tax) && total > 0 && tax > 0 && tax < total * 0.2) {
      let sub = !Number.isNaN(trailing) && trailing > 0 && trailing < total - tax
        ? trailing
        : Math.round((total - tax) * 100) / 100;
      return {
        total_amount: negExpense(total),
        tax_amount: negExpense(tax),
        subtotal: negExpense(sub),
      };
    }
  }

  return null;
}

/** Wonderland / WF&E: # SHIPPED TOTAL $101.15 1 11.64 89.51 FREIGHT TAX */
export function parseCreditMemoAmounts(text: string): {
  subtotal: number;
  tax_amount: number;
  total_amount: number;
} | null {
  if (!text?.trim()) return null;

  const shipped = parseWonderlandShippedTotal(text);
  if (shipped) return shipped;

  const amountPaid = text.match(/Amount\s+\$?\s*([\d,]+\.\d{2})\s*\.?\s*\+?\s*tax/i);
  if (amountPaid) {
    const sub = num(amountPaid[1]);
    if (!Number.isNaN(sub) && sub > 0) {
      const hst = text.match(/(?:GST\/HST|HST)\s+#?\s*\$?\s*([\d,]+\.\d{2})/i);
      const tax = hst ? num(hst[1]) : NaN;
      if (!Number.isNaN(tax) && tax > 0) {
        return {
          subtotal: negExpense(sub),
          tax_amount: negExpense(tax),
          total_amount: negExpense(sub + tax),
        };
      }
      return { subtotal: negExpense(sub), tax_amount: negExpense(0), total_amount: negExpense(sub) };
    }
  }

  return null;
}

export function applyCreditMemoExtraction(
  invoiceText: string,
  current: {
    vendor_name?: string | null;
    invoice_number?: string | null;
    subtotal?: number | null;
    tax_amount?: number | null;
    total_amount?: number | null;
  },
): {
  document_type: ExpenseDocumentType;
  credit_memo_against: string | null;
  vendor_name: string | null;
  invoice_number: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  total_amount: number | null;
} {
  const isCredit = detectCreditMemoFromText(invoiceText);
  if (!isCredit) {
    return {
      document_type: "invoice",
      credit_memo_against: null,
      vendor_name: current.vendor_name ?? null,
      invoice_number: current.invoice_number ?? null,
      subtotal: current.subtotal ?? null,
      tax_amount: current.tax_amount ?? null,
      total_amount: current.total_amount ?? null,
    };
  }

  const refs = parseCreditMemoReferences(invoiceText);
  const amounts = parseCreditMemoAmounts(invoiceText);
  const invoice_number = refs.order_number || current.invoice_number || refs.original_invoice_number || null;

  return {
    document_type: "credit_memo",
    credit_memo_against: refs.original_invoice_number,
    vendor_name: current.vendor_name ?? null,
    invoice_number,
    subtotal: amounts?.subtotal ?? current.subtotal ?? null,
    tax_amount: amounts?.tax_amount ?? current.tax_amount ?? null,
    total_amount: amounts?.total_amount ?? current.total_amount ?? null,
  };
}
