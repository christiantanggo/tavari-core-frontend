/**
 * Core metrics for monthly dividend income optimization.
 * Rank by monthly income created, not yield label alone.
 */

/** Convert a price/div amount into CAD when the instrument is USD. */
export function toCad(amount, currency = 'CAD', usdCadRate = null) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  if (String(currency || 'CAD').toUpperCase() !== 'USD') return n;
  const fx = Number(usdCadRate);
  if (!Number.isFinite(fx) || fx <= 0) return null;
  return n * fx;
}

export function monthlyIncomePerDollar(monthlyDividend, price) {
  const d = Number(monthlyDividend);
  const p = Number(price);
  if (!Number.isFinite(d) || !Number.isFinite(p) || p <= 0 || d < 0) return null;
  return d / p;
}

export function incomeCreated(cash, price, monthlyDividend) {
  const c = Number(cash);
  const p = Number(price);
  const d = Number(monthlyDividend);
  if (!Number.isFinite(c) || !Number.isFinite(p) || !Number.isFinite(d) || p <= 0 || c < 0) {
    return { shares: null, monthlyIncome: null, annualIncome: null };
  }
  const shares = c / p;
  const monthlyIncome = shares * d;
  return {
    shares,
    monthlyIncome,
    annualIncome: monthlyIncome * 12,
  };
}

export function qualifyInstrument(instrument, { minStableMonths = 24 } = {}) {
  if (!instrument) {
    return { qualified: false, reason: 'Missing instrument' };
  }
  if (instrument.active === false) {
    return { qualified: false, reason: 'Inactive' };
  }
  if (instrument.pays_monthly === false) {
    return { qualified: false, reason: 'Not a monthly payer' };
  }
  if (instrument.variable_distribution === true) {
    return {
      qualified: false,
      reason: instrument.disqualified_reason || 'Variable distribution (tied to price/NAV)',
    };
  }

  const div = Number(instrument.expected_monthly_dividend);
  const price = Number(instrument.last_price);
  if (!Number.isFinite(div) || div <= 0) {
    return { qualified: false, reason: 'Missing expected monthly dividend' };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { qualified: false, reason: 'Missing current price' };
  }

  // Manual: "streak is fine — include in Best Buy ranking"
  if (instrument.streak_bypass === true) {
    return { qualified: true, reason: null, bypassed: true };
  }

  const stable = Number(instrument.stable_months) || 0;
  if (stable < minStableMonths) {
    return {
      qualified: false,
      reason: `Stable for ${stable} months (need ${minStableMonths}+)`,
    };
  }
  if (instrument.disqualified_reason) {
    return { qualified: false, reason: instrument.disqualified_reason };
  }
  return { qualified: true, reason: null, bypassed: false };
}

/**
 * Rank by monthly income created per dollar of *CAD cash*.
 * USD prices/dividends are converted with usdCadRate (CAD per 1 USD).
 */
export function rankInstruments(
  instruments,
  cashAmounts = [1000, 1330, 10000],
  { usdCadRate = null } = {}
) {
  const rows = (instruments || []).map((inst) => {
    const qualification = qualifyInstrument(inst);
    const currency = inst.currency || 'CAD';
    const priceCad = toCad(inst.last_price, currency, usdCadRate);
    const divCad = toCad(inst.expected_monthly_dividend, currency, usdCadRate);
    // Fallback to native units if FX missing (same-currency still ranks correctly).
    const priceForRank = priceCad ?? Number(inst.last_price);
    const divForRank = divCad ?? Number(inst.expected_monthly_dividend);
    const perDollar = monthlyIncomePerDollar(divForRank, priceForRank);
    const byCash = {};
    for (const cash of cashAmounts) {
      byCash[cash] = incomeCreated(cash, priceForRank, divForRank);
    }
    const yieldAnnual =
      Number.isFinite(perDollar) && perDollar != null ? perDollar * 12 : null;

    return {
      ...inst,
      currency,
      qualification,
      qualified: qualification.qualified,
      streakBypassed: !!qualification.bypassed,
      incomePerDollar: perDollar,
      annualYield: yieldAnnual,
      incomeByCash: byCash,
      priceCad,
      dividendCad: divCad,
    };
  });

  const qualified = rows
    .filter((r) => r.qualified)
    .sort((a, b) => (b.incomePerDollar || 0) - (a.incomePerDollar || 0));
  const unqualified = rows.filter((r) => !r.qualified);

  let rank = 1;
  for (const row of qualified) {
    row.rank = rank++;
  }
  for (const row of unqualified) {
    row.rank = null;
  }

  return [...qualified, ...unqualified];
}

export function holdingMetrics(holding, instrument) {
  const shares = Number(holding?.shares) || 0;
  const avgCost = Number(holding?.avg_cost);
  const price = Number(instrument?.last_price);
  const monthlyDiv = Number(instrument?.expected_monthly_dividend);
  const marketValue = Number.isFinite(price) ? shares * price : null;
  const monthlyIncome = Number.isFinite(monthlyDiv) ? shares * monthlyDiv : null;
  const costBasis =
    Number.isFinite(avgCost) && shares > 0 ? shares * avgCost : null;
  const yieldOnCost =
    Number.isFinite(avgCost) && avgCost > 0 && Number.isFinite(monthlyDiv)
      ? (monthlyDiv * 12) / avgCost
      : null;

  return {
    shares,
    avgCost: Number.isFinite(avgCost) ? avgCost : null,
    marketValue,
    monthlyIncome,
    annualIncome: monthlyIncome != null ? monthlyIncome * 12 : null,
    costBasis,
    yieldOnCost,
  };
}

export function formatCad(n, digits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(n));
}

export function formatMoney(n, currency = 'CAD', digits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const code = String(currency || 'CAD').toUpperCase() === 'USD' ? 'USD' : 'CAD';
  return new Intl.NumberFormat(code === 'USD' ? 'en-US' : 'en-CA', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(n));
}

export function formatShares(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(Number(n));
}

export function formatPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${(Number(n) * 100).toFixed(2)}%`;
}

/** Consecutive months of same-or-higher monthly dividend; caps display at 36+. */
export function formatStableStreak(months) {
  const n = Number(months);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n >= 36) return '36+';
  return String(Math.floor(n));
}
