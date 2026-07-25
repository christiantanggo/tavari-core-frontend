/** Mirrors supabase/functions/_shared/invoiceTextFallback.ts amount reconciliation for frontend draft updates. */

import { getEffectiveExpenseAmounts } from './accountingDraftAmounts';

const round2 = (n) => Math.round(n * 100) / 100;
const negExpense = (v) => -Math.abs(v);

export function normalizeExtractedAmount(value, totalAbs) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const abs = Math.abs(Number(value));
  if (abs < 0.01) return null;
  if (totalAbs != null && abs >= totalAbs * 0.95) return null;
  return Number(value);
}

export function finalizeExpenseAmounts(raw, options = {}) {
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

  const normalizeExpenseAmount = (value) => {
    if (value == null || Number.isNaN(value) || value === 0) return value;
    return value > 0 ? -Math.abs(value) : value;
  };

  return {
    subtotal: subtotal != null ? normalizeExpenseAmount(subtotal) : null,
    tax_amount: tax_amount != null && Math.abs(Number(tax_amount)) >= 0.01
      ? normalizeExpenseAmount(tax_amount)
      : null,
    total_amount: total_amount != null ? normalizeExpenseAmount(total_amount) : null,
  };
}

export function isExpenseAmountsIncomplete(amounts) {
  const totalAbs = amounts.total_amount != null ? Math.abs(Number(amounts.total_amount)) : 0;
  if (totalAbs < 0.01) return true;
  const subAbs = amounts.subtotal != null ? Math.abs(Number(amounts.subtotal)) : 0;
  const taxAbs = amounts.tax_amount != null ? Math.abs(Number(amounts.tax_amount)) : 0;
  if (subAbs < 0.01) return true;
  if (taxAbs < 0.01 && Math.abs(subAbs - totalAbs) > 0.02) return true;
  if (Math.abs(subAbs + taxAbs - totalAbs) > 0.05) return true;
  return false;
}

export function isExemptHstTreatment(treatment) {
  return String(treatment || '').trim().toLowerCase() === 'exempt';
}

export function reconcileDraftExpenseAmounts({ subtotal, tax_amount, total_amount, hst_treatment }) {
  const totalNum = total_amount != null && !Number.isNaN(Number(total_amount)) ? Number(total_amount) : null;
  const totalAbs = totalNum != null ? Math.abs(totalNum) : null;
  if (totalAbs == null || totalAbs < 0.01) {
    return { subtotal, tax_amount, total_amount };
  }

  const sign = totalNum < 0 ? -1 : 1;
  const treatment = String(hst_treatment || 'recoverable').trim().toLowerCase();

  if (isExemptHstTreatment(treatment)) {
    const total = sign * totalAbs;
    return { total_amount: total, subtotal: total, tax_amount: 0 };
  }

  let taxAbs = tax_amount != null && !Number.isNaN(Number(tax_amount))
    ? Math.abs(Number(tax_amount))
    : 0;
  if (taxAbs > totalAbs) taxAbs = 0;

  const subtotalAbs = round2(totalAbs - taxAbs);
  return {
    total_amount: sign * totalAbs,
    subtotal: sign * subtotalAbs,
    tax_amount: taxAbs >= 0.01 ? sign * taxAbs : 0,
  };
}

export function isCreditMemoExpense(expense) {
  return String(expense?.document_type || '').toLowerCase() === 'credit_memo';
}

/** document_type is the only signal — expense amounts are always stored negative in Tavari. */
export function resolveDraftDocumentType({ document_type, is_credit_memo } = {}) {
  if (is_credit_memo === true || String(document_type || '').toLowerCase() === 'credit_memo') {
    return 'credit_memo';
  }
  return 'invoice';
}

/** Signed amount for register totals: invoices positive, credit memos negative. */
export function signedExpenseAmount(value, isCreditMemo) {
  const abs = Math.abs(Number(value) || 0);
  if (abs < 0.0001) return 0;
  return isCreditMemo ? -abs : abs;
}

/** Net recoverable ITC (credit memos reduce ITC). Mirrors gst34Worksheet.ts. */
export function sumPostedExpenseRecoverableItc(expenses) {
  return round2(
    (expenses || [])
      .filter((e) => ['recoverable', 'included'].includes(String(e.hst_treatment || '').toLowerCase()))
      .reduce((sum, e) => {
        const tax = Math.abs(Number(e.tax_amount) || 0);
        if (tax < 0.0001) return sum;
        return sum + signedExpenseAmount(tax, isCreditMemoExpense(e));
      }, 0),
  );
}

export function sumExpenseRegisterTotals(expenses) {
  let subtotal = 0;
  let total = 0;
  for (const e of expenses || []) {
    const amounts = getEffectiveExpenseAmounts(e);
    const isCredit = isCreditMemoExpense(e);
    subtotal += signedExpenseAmount(amounts.subtotal, isCredit);
    total += signedExpenseAmount(amounts.total, isCredit);
  }
  return {
    subtotal: round2(subtotal),
    tax: sumPostedExpenseRecoverableItc(expenses),
    total: round2(total),
    count: expenses?.length || 0,
  };
}
