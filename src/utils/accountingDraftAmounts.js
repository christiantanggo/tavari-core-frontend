const round2 = (n) => (n != null && !Number.isNaN(n) ? Math.round(Number(n) * 100) / 100 : n);

/** Draft/payload amounts are negative for expenses; bank matching uses absolute value. */
export function getDraftPostingAmount(draftOrPayload) {
  const cad = draftOrPayload?.cad_settlement_total;
  if (cad != null && cad !== '' && !Number.isNaN(Number(cad))) {
    const abs = Math.abs(round2(Number(cad)));
    if (abs > 0) return -abs;
  }
  if (draftOrPayload?.total_amount != null && !Number.isNaN(Number(draftOrPayload.total_amount))) {
    return Number(draftOrPayload.total_amount);
  }
  return null;
}

export function getDraftBankMatchAmount(draftOrPayload) {
  const posting = getDraftPostingAmount(draftOrPayload);
  return posting != null ? Math.abs(round2(posting)) : null;
}

export function isForeignCurrencyDraft(draftOrPayload) {
  const currency = String(draftOrPayload?.invoice_currency || 'CAD').trim().toUpperCase();
  return currency !== '' && currency !== 'CAD';
}

export function needsCadSettlement(draftOrPayload) {
  return isForeignCurrencyDraft(draftOrPayload)
    && (draftOrPayload?.cad_settlement_total == null || draftOrPayload?.cad_settlement_total === '');
}

/** Amounts used for posting, bank match, and register display (CAD settlement wins for foreign invoices). */
export function getEffectiveExpenseAmounts(draftOrPayload) {
  const invoiceCurrency = String(draftOrPayload?.invoice_currency || 'CAD').trim().toUpperCase();
  const cadRaw = draftOrPayload?.cad_settlement_total;
  const cadAbs = cadRaw != null && cadRaw !== '' && !Number.isNaN(Number(cadRaw))
    ? Math.abs(round2(Number(cadRaw)))
    : null;
  const useCad = invoiceCurrency !== 'CAD' && cadAbs != null && cadAbs > 0;
  const isCredit = String(draftOrPayload?.document_type || '').toLowerCase() === 'credit_memo';
  const sign = isCredit || Number(draftOrPayload?.total_amount) < 0 ? -1 : 1;

  if (useCad) {
    return {
      subtotal: sign * cadAbs,
      tax_amount: 0,
      total: sign * cadAbs,
      displayCurrency: 'CAD',
      invoiceCurrency,
      usedCadSettlement: true,
    };
  }

  return {
    subtotal: draftOrPayload?.subtotal,
    tax_amount: draftOrPayload?.tax_amount,
    total: draftOrPayload?.total_amount,
    displayCurrency: invoiceCurrency === 'CAD' ? 'CAD' : invoiceCurrency,
    invoiceCurrency,
    usedCadSettlement: false,
  };
}

export function getEffectiveExpenseAmountAbs(draftOrPayload) {
  const { total } = getEffectiveExpenseAmounts(draftOrPayload);
  return total != null && !Number.isNaN(Number(total)) ? Math.abs(round2(Number(total))) : null;
}
