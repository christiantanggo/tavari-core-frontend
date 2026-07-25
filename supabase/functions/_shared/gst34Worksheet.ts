export function normalizeAccountBase(name: string): string {
  return name.toLowerCase().replace(/\s+-\s+[a-z0-9]+$/i, '').trim();
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function sumPostedExpenseRecoverableItc(
  expenses: Array<{ tax_amount?: unknown; hst_treatment?: unknown; document_type?: unknown }>,
): number {
  return round2(
    (expenses || [])
      .filter((e) => ['recoverable', 'included'].includes(String(e.hst_treatment || '').toLowerCase()))
      .reduce((sum, e) => {
        const tax = Math.abs(Number(e.tax_amount || 0));
        if (tax < 0.0001) return sum;
        const isCreditMemo = String(e.document_type || '').toLowerCase() === 'credit_memo';
        return sum + (isCreditMemo ? -tax : tax);
      }, 0),
  );
}

export function normalizeHstSummary(worksheet: Record<string, number>) {
  const collected = Math.abs(Number(worksheet?.box_103 || worksheet?.hst_collected || 0) || 0);
  const recoverable = Math.abs(Number(worksheet?.box_106 || worksheet?.hst_recoverable || 0) || 0);
  const sales = Math.abs(Number(worksheet?.box_101 || worksheet?.sales_total || 0) || 0);
  const net = Math.round((collected - recoverable) * 100) / 100;
  return {
    sales_total: Math.round(sales * 100) / 100,
    hst_collected: Math.round(collected * 100) / 100,
    hst_paid_on_expenses: Math.round(recoverable * 100) / 100,
    net_hst_owed: net,
    filing_position: net >= 0 ? 'owed' as const : 'refund' as const
  };
}

export const GST34_BOX_LABELS: Record<string, string> = {
  box_101: 'Line 101 — Total sales and other revenue',
  box_103: 'Line 103 — GST/HST collected or collectible',
  box_106: 'Line 106 — Input tax credits (ITC)',
  box_109: 'Line 109 — Net tax (remittance or refund)'
};

export function deriveGst34Worksheet(
  glRows: unknown[],
  glColumns?: Array<{ fieldname?: string; label?: string }>,
  mapping?: {
    revenueAccounts?: string[];
    hstCollectedAccounts?: string[];
    hstRecoverableAccounts?: string[];
  }
): { worksheet: Record<string, number>; warnings: string[] } {
  const box: Record<string, number> = {
    box_101: 0,
    box_103: 0,
    box_106: 0,
    box_109: 0,
    sales_total: 0,
    hst_collected: 0,
    hst_recoverable: 0
  };
  const warnings: string[] = [];
  const revenueAccounts = new Set((mapping?.revenueAccounts || []).map(normalizeAccountBase));
  const hstCollectedAccounts = new Set((mapping?.hstCollectedAccounts || []).map(normalizeAccountBase));
  const hstRecoverableAccounts = new Set((mapping?.hstRecoverableAccounts || []).map(normalizeAccountBase));
  const overlappingTaxAccounts = [...hstCollectedAccounts].filter((a) => hstRecoverableAccounts.has(a));
  let skippedRows = 0;
  let regexFallbackUsed = false;
  if (!Array.isArray(glRows)) return { worksheet: box, warnings: ['ERPNext returned no GL rows for GST34 calculation.'] };

  const resolveValue = (row: unknown, fieldNames: string[]) => {
    if (Array.isArray(row)) {
      const index = (glColumns || []).findIndex((column) => fieldNames.includes(String(column?.fieldname || '').toLowerCase()));
      return index >= 0 ? row[index] : undefined;
    }
    if (row && typeof row === 'object') {
      const record = row as Record<string, unknown>;
      for (const fieldName of fieldNames) {
        if (record[fieldName] != null) return record[fieldName];
      }
    }
    return undefined;
  };

  for (const row of glRows) {
    if (!row || typeof row !== 'object') continue;
    const account = (resolveValue(row, ['account', 'account_name', 'name']) ?? '').toString().toLowerCase();
    if (!account) {
      skippedRows += 1;
      continue;
    }
    const debit = Number(resolveValue(row, ['debit', 'debit_in_account_currency']) ?? 0) || 0;
    const credit = Number(resolveValue(row, ['credit', 'credit_in_account_currency']) ?? 0) || 0;
    const balance = Number(resolveValue(row, ['balance', 'balance_in_account_currency']) ?? 0) || 0;
    const hasExplicitLineAmounts = debit !== 0 || credit !== 0;
    const revenueAmount = hasExplicitLineAmounts ? (credit - debit) : Math.abs(balance);
    const collectedAmount = hasExplicitLineAmounts ? (credit - debit) : (balance < 0 ? Math.abs(balance) : 0);
    const recoverableAmount = hasExplicitLineAmounts ? (debit - credit) : (balance > 0 ? Math.abs(balance) : 0);
    const normalizedAccount = normalizeAccountBase(account);
    const matchesRevenue = revenueAccounts.size > 0
      ? revenueAccounts.has(normalizedAccount)
      : /sales|revenue|income/.test(account) && !/hst|tax|gst/.test(account);
    const matchesCollected = hstCollectedAccounts.size > 0
      ? hstCollectedAccounts.has(normalizedAccount)
      : /hst.*collect|gst.*collect|tax.*collect|output.*tax/.test(account);
    const matchesRecoverable = hstRecoverableAccounts.size > 0
      ? hstRecoverableAccounts.has(normalizedAccount)
      : /hst.*recover|gst.*recover|input.*tax|itc/.test(account);
    const matchesBothMapped = matchesCollected && matchesRecoverable;
    const genericTaxAccount = /(^|\b)(hst|gst|tax)(\b|$)/.test(account) && !matchesCollected && !matchesRecoverable;
    if (revenueAccounts.size === 0 || hstCollectedAccounts.size === 0 || hstRecoverableAccounts.size === 0) {
      regexFallbackUsed = true;
    }
    if (matchesRevenue) box.sales_total += revenueAmount;
    if (matchesBothMapped) {
      // Same GL account mapped for collected and recoverable — split by debit/credit, never both formulas on one row.
      if (hasExplicitLineAmounts) {
        if (credit > debit) box.hst_collected += round2(credit - debit);
        if (debit > credit) box.hst_recoverable += round2(debit - credit);
      } else if (balance < 0) {
        box.hst_collected += Math.abs(balance);
      } else if (balance > 0) {
        box.hst_recoverable += Math.abs(balance);
      }
    } else {
      if (matchesCollected) box.hst_collected += collectedAmount;
      if (matchesRecoverable) box.hst_recoverable += recoverableAmount;
    }
    if (genericTaxAccount) {
      if (hasExplicitLineAmounts) {
        const netTax = credit - debit;
        if (netTax > 0) box.hst_collected += netTax;
        if (netTax < 0) box.hst_recoverable += Math.abs(netTax);
      } else if (balance < 0) {
        box.hst_collected += Math.abs(balance);
      } else if (balance > 0) {
        box.hst_recoverable += Math.abs(balance);
      }
    }
  }

  box.box_101 = Math.round(box.sales_total * 100) / 100;
  box.box_103 = Math.round(box.hst_collected * 100) / 100;
  box.box_106 = Math.round(Math.max(0, box.hst_recoverable) * 100) / 100;
  box.box_109 = Math.round((box.box_103 - box.box_106) * 100) / 100;
  if (overlappingTaxAccounts.length > 0) {
    warnings.push(
      `HST Collected and HST Recoverable map to the same account (${overlappingTaxAccounts.join(', ')}). Use separate accounts (e.g. HST for collected, GST for ITC) for clearer GST34 totals.`
    );
  }
  if (regexFallbackUsed) {
    warnings.push('Some GST/HST totals used heuristic account-name matching. Set HST Collected and HST Recoverable in Accounting → Settings.');
  }
  if (skippedRows > 0) {
    warnings.push(`${skippedRows} GL row(s) were skipped because they did not contain an account name.`);
  }
  return { worksheet: box, warnings };
}

/** Parse ERPNext Trial Balance Total row — do not sum group + leaf rows (double-counts). */
export function summarizeTrialBalanceReport(rows: unknown[]): {
  hasTotalRow: boolean;
  periodDebit: number;
  periodCredit: number;
  periodDifference: number;
  openingDifference: number;
  closingDifference: number;
} {
  const empty = {
    hasTotalRow: false,
    periodDebit: 0,
    periodCredit: 0,
    periodDifference: 0,
    openingDifference: 0,
    closingDifference: 0,
  };
  if (!Array.isArray(rows)) return empty;

  const totalRow = rows.find((row) => {
    if (!row || typeof row !== 'object') return false;
    const r = row as Record<string, unknown>;
    const label = String(r.account_name || r.account || '').replace(/'/g, '').trim().toLowerCase();
    return label === 'total';
  }) as Record<string, unknown> | undefined;

  if (!totalRow) return empty;

  const periodDebit = Number(totalRow.debit || 0) || 0;
  const periodCredit = Number(totalRow.credit || 0) || 0;
  const openingDebit = Number(totalRow.opening_debit || 0) || 0;
  const openingCredit = Number(totalRow.opening_credit || 0) || 0;
  const closingDebit = Number(totalRow.closing_debit || 0) || 0;
  const closingCredit = Number(totalRow.closing_credit || 0) || 0;

  return {
    hasTotalRow: true,
    periodDebit: round2(periodDebit),
    periodCredit: round2(periodCredit),
    periodDifference: round2(Math.abs(periodDebit - periodCredit)),
    openingDifference: round2(Math.abs(openingDebit - openingCredit)),
    closingDifference: round2(Math.abs(closingDebit - closingCredit)),
  };
}
