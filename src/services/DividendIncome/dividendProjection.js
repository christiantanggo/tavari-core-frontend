/**
 * Networth.csv-style DRIP projection at a frozen price/dividend snapshot.
 *
 * Each month:
 *   dividendCollected = shares * monthlyDividend
 *   worth = shares * price
 *   then shares += (dividendCollected + cashAdded) / price   (if DRIP / contributions buy shares)
 */

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function toMonthKey(year, monthIndex) {
  return Number(year) * 12 + Number(monthIndex);
}

/**
 * contributionWindows: [{
 *   name, amount,
 *   startYear, startMonthIndex,
 *   endYear, endMonthIndex  // end optional / blank = ongoing
 * }]
 */
export function contributionAmountForMonth(windows, year, monthIndex) {
  const key = toMonthKey(year, monthIndex);
  let total = 0;
  const applied = [];
  for (const w of windows || []) {
    const amount = Number(w.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const start = toMonthKey(w.startYear, w.startMonthIndex);
    if (!Number.isFinite(start) || key < start) continue;
    const hasEnd =
      w.endYear !== '' &&
      w.endYear != null &&
      w.endMonthIndex !== '' &&
      w.endMonthIndex != null &&
      Number.isFinite(Number(w.endYear)) &&
      Number.isFinite(Number(w.endMonthIndex));
    if (hasEnd) {
      const end = toMonthKey(w.endYear, w.endMonthIndex);
      if (key > end) continue;
    }
    total += amount;
    applied.push({ name: w.name || 'Contribution', amount });
  }
  return { total, applied };
}

export function buildDripProjection({
  startingShares,
  price,
  monthlyDividend,
  startYear,
  startMonthIndex = 0, // 0 = January
  months = 240,
  startingAge = null,
  dripEnabled = true,
  monthlyContribution = 0,
  contribution2 = 0,
  contributionWindows = [], // dated monthly add ranges
  oneTimeAdds = [], // [{ year, monthIndex, amount }]
  splitsPerYear = 0, // 0 | 1 | 2 — each split = +10% share count
}) {
  const shares0 = Number(startingShares);
  const p = Number(price);
  const d = Number(monthlyDividend);
  const nMonths = Math.max(1, Math.floor(Number(months) || 1));

  if (!Number.isFinite(shares0) || shares0 < 0) {
    throw new Error('Starting shares must be a non-negative number');
  }
  if (!Number.isFinite(p) || p <= 0) {
    throw new Error('Price must be greater than zero');
  }
  if (!Number.isFinite(d) || d < 0) {
    throw new Error('Monthly dividend must be a non-negative number');
  }

  const addMap = new Map();
  for (const a of oneTimeAdds || []) {
    if (!a || !Number.isFinite(Number(a.amount)) || Number(a.amount) === 0) continue;
    const key = `${Number(a.year)}-${Number(a.monthIndex)}`;
    addMap.set(key, (addMap.get(key) || 0) + Number(a.amount));
  }

  // Merge legacy always-on monthly fields into windows for the full projection span
  const windows = [...(contributionWindows || [])];
  const legacy1 = Number(monthlyContribution) || 0;
  const legacy2 = Number(contribution2) || 0;
  if (legacy1) {
    windows.push({
      name: 'Monthly add',
      amount: legacy1,
      startYear: Number(startYear),
      startMonthIndex: Number(startMonthIndex),
      endYear: null,
      endMonthIndex: null,
    });
  }
  if (legacy2) {
    windows.push({
      name: 'Monthly add 2',
      amount: legacy2,
      startYear: Number(startYear),
      startMonthIndex: Number(startMonthIndex),
      endYear: null,
      endMonthIndex: null,
    });
  }

  let shares = shares0;
  let year = Number(startYear);
  let monthIndex = Number(startMonthIndex);
  if (!Number.isFinite(year)) year = new Date().getFullYear();
  if (!Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) monthIndex = 0;

  let age = startingAge == null || startingAge === '' ? null : Number(startingAge);
  const rows = [];
  let cumulativeContributions = 0;
  let cumulativeDividends = 0;
  let lastDisplayedYear = null;
  let lastDisplayedAge = null;

  for (let i = 0; i < nMonths; i++) {
    const dividendPerShare = d;
    const dividendCollected = shares * dividendPerShare;
    const { total: windowCash, applied } = contributionAmountForMonth(windows, year, monthIndex);
    const oneTime = addMap.get(`${year}-${monthIndex}`) || 0;
    const cashAdded = windowCash + oneTime;
    const worth = shares * p;

    cumulativeDividends += dividendCollected;
    cumulativeContributions += cashAdded;

    const displayYear = lastDisplayedYear !== year ? year : null;
    if (displayYear != null) lastDisplayedYear = year;

    let displayAge = null;
    if (age != null && Number.isFinite(age)) {
      const ageFloor = Math.floor(age);
      if (lastDisplayedAge == null || ageFloor > lastDisplayedAge) {
        displayAge = ageFloor;
        lastDisplayedAge = ageFloor;
      }
    }

    rows.push({
      year,
      displayYear,
      monthIndex,
      monthName: MONTH_NAMES[monthIndex],
      age: displayAge,
      dividendPerShare,
      shares,
      dividendCollected,
      contribution1: windowCash,
      contribution2: 0,
      contributionWindowsApplied: applied,
      oneTime,
      cashAdded,
      worth,
      monthlyIncome: dividendCollected,
      annualIncomeRunRate: dividendCollected * 12,
      cumulativeDividends,
      cumulativeContributions,
    });

    const reinvestCash = (dripEnabled ? dividendCollected : 0) + cashAdded;
    if (reinvestCash > 0) {
      shares += reinvestCash / p;
    }

    if (splitsPerYear > 0 && monthIndex === 11) {
      const times = Math.min(2, Math.max(0, Math.floor(splitsPerYear)));
      for (let s = 0; s < times; s++) {
        shares *= 1.1;
      }
    }

    if (age != null && Number.isFinite(age)) {
      age += 1 / 12;
    }

    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
  }

  return {
    rows,
    summary: summarizeProjection(rows, p, d),
  };
}

function summarizeProjection(rows, price, monthlyDividend) {
  if (!rows.length) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const at = (monthOffset) => {
    const idx = Math.min(rows.length - 1, monthOffset);
    return rows[idx];
  };

  return {
    startShares: first.shares,
    startWorth: first.worth,
    startMonthlyIncome: first.dividendCollected,
    endShares: last.shares + (last.dividendCollected + last.cashAdded) / price,
    endWorth: last.worth,
    endMonthlyIncome: last.dividendCollected,
    endAnnualIncome: last.dividendCollected * 12,
    y5: at(12 * 5 - 1),
    y10: at(12 * 10 - 1),
    y15: at(12 * 15 - 1),
    y20: at(12 * 20 - 1),
    price,
    monthlyDividend,
  };
}

export { MONTH_NAMES };
