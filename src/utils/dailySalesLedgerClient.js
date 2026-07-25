/**
 * Client-side daily sales ledger (reads cached daily_sales_ledger_days when available).
 * Falls back to live aggregation for uncached ranges; recent days refresh automatically.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const PAGE_SIZE = 1000;

function parseDayEndTime(raw) {
  if (!raw) return { hour: 23, minute: 59 };
  const parts = String(raw).trim().split(':');
  return {
    hour: parseInt(parts[0] || '23', 10) || 0,
    minute: parseInt(parts[1] || '59', 10) || 0,
  };
}

function usesCalendarDayCutoff(dayEnd) {
  return dayEnd.hour >= 23 && dayEnd.minute >= 59;
}

export function businessDayKeyForIso(iso, timeZone, salesDayEndTime) {
  const dayEnd = parseDayEndTime(salesDayEndTime);
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const localKey = `${parts.year}-${parts.month}-${parts.day}`;
  if (usesCalendarDayCutoff(dayEnd)) return localKey;

  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const minutes = hour * 60 + minute;
  const endMinutes = dayEnd.hour * 60 + dayEnd.minute;
  if (minutes > endMinutes) {
    const [y, m, day] = localKey.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, day + 1));
    return next.toISOString().slice(0, 10);
  }
  return localKey;
}

export function getBusinessDayWindowUtc(startDateKey, endDateKey, timeZone, salesDayEndTime) {
  const dayEnd = parseDayEndTime(salesDayEndTime);
  const startWindow = getSingleDayWindowUtc(startDateKey, timeZone, salesDayEndTime);
  const endWindow = getSingleDayWindowUtc(endDateKey, timeZone, salesDayEndTime);
  return { startUtc: startWindow.startUtc, endUtc: endWindow.endUtc };
}

function getSingleDayWindowUtc(businessDateKey, timeZone, salesDayEndTime) {
  const dayEnd = parseDayEndTime(salesDayEndTime);
  if (usesCalendarDayCutoff(dayEnd)) {
    return {
      startUtc: dayjs.tz(`${businessDateKey}T00:00:00`, timeZone).toISOString(),
      endUtc: dayjs.tz(`${businessDateKey}T23:59:59.999`, timeZone).toISOString(),
    };
  }
  const prevKey = dayjs.tz(`${businessDateKey}T12:00:00`, timeZone).subtract(1, 'day').format('YYYY-MM-DD');
  const endH = String(dayEnd.hour).padStart(2, '0');
  const endM = String(dayEnd.minute).padStart(2, '0');
  return {
    startUtc: dayjs.tz(`${prevKey}T${endH}:01:00`, timeZone).toISOString(),
    endUtc: dayjs.tz(`${businessDateKey}T${endH}:59.999`, timeZone).toISOString(),
  };
}

function dateKeysBetween(startDateKey, endDateKey) {
  const dates = [];
  const [sy, sm, sd] = startDateKey.split('-').map(Number);
  const [ey, em, ed] = endDateKey.split('-').map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  for (let t = start; t <= end; t += 86400000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

async function fetchAllPages(label, queryFn) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryFn(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`${label}: ${error.message || error.details || 'query failed'}`);
    }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

function normalizeTenderCategory(label, labelKey = '') {
  const combined = `${labelKey} ${label}`.toLowerCase();
  if (combined.includes('cash')) return 'cash';
  if (combined.includes('debit') || combined.includes('interac')) return 'debit';
  if (combined.includes('credit') || combined.includes('card') || combined.includes('visa') || combined.includes('master') || combined.includes('amex')) {
    return 'credit';
  }
  return 'other';
}

function posPaymentTenderCategory(method, notes) {
  const m = String(method || '').toLowerCase();
  if (m === 'cash') return 'cash';
  if (m === 'debit') return 'debit';
  if (m === 'card' || m === 'credit' || m === 'helcim_terminal' || m === 'helcim') return 'credit';
  return 'credit';
}

function posRefundTenderCategory(method) {
  const m = String(method || 'cash').toLowerCase();
  if (m === 'cash') return 'cash';
  if (m === 'debit') return 'debit';
  return 'credit';
}

function cloverTenderKeyFromRaw(raw) {
  if (!raw || typeof raw !== 'object') return 'other';
  const tenderRef = raw.tender;
  if (tenderRef?.label || tenderRef?.labelKey) {
    return normalizeTenderCategory(String(tenderRef.label || ''), String(tenderRef.labelKey || ''));
  }
  if (raw.cashTendered || raw.cashTender) return 'cash';
  const cardTx = raw.cardTransaction;
  if (cardTx?.cardType) return normalizeTenderCategory(String(cardTx.cardType), String(cardTx.cardType));
  return 'other';
}

function cloverSignedAmount(row) {
  const amount = Math.abs(Number(row.amount) || 0);
  if (amount <= 0) return 0;
  const kind = String(row.transaction_kind || '').toLowerCase();
  const status = String(row.status || '').toLowerCase();
  const result = String(row.result || '').toUpperCase();
  if (kind === 'refund') return -amount;
  if (kind === 'void' || status.includes('void')) return 0;
  if (result === 'FAIL' || result === 'FAILED' || status.includes('declin')) return 0;
  return amount;
}

function authorizeNetSignedAmount(row) {
  const amount = Math.abs(Number(row.amount) || 0);
  if (amount <= 0) return 0;
  const kind = String(row.transaction_kind || '').toLowerCase();
  const status = String(row.status || '').toLowerCase();
  if (kind === 'refund') return -amount;
  if (kind === 'void' || status.includes('void')) return 0;
  if (status.includes('declin') || status === 'declined') return 0;
  if (status.includes('held') && !status.includes('captured')) return 0;
  return amount;
}

/** manualCash = additional cash only (not rung through Clover, Helcim, or Authorize.net). */
export function computeTotalSales(clover, helcim, authorizeNet, manualCash) {
  if (manualCash == null) return null;
  return Math.round((clover + helcim + authorizeNet + manualCash) * 100) / 100;
}

/** Full ledger total: entered additional cash, or channel sales when additional cash is not entered yet. */
export function resolveTotalSales(clover, helcim, authorizeNet, manualCash) {
  if (manualCash != null) {
    return computeTotalSales(clover, helcim, authorizeNet, manualCash);
  }
  const channel = channelSalesTotal(clover, helcim, authorizeNet);
  if (channel > 0) return channel;
  return null;
}

export function channelSalesTotal(clover, helcim, authorizeNet) {
  return Math.round((Number(clover) + Number(helcim) + Number(authorizeNet)) * 100) / 100;
}

/**
 * Channel columns for one ledger day.
 * Clover (in-store register) and Helcim (Tavari POS) are separate systems and both count
 * toward the day total — do not hide Clover when Tavari POS sales exist.
 */
export function resolveChannelSalesForDay({
  apiClover = 0,
  apiHelcim = 0,
  apiAuthorize = 0,
  excelClover = null,
  excelAuthorize = null,
}) {
  const apiPos = Math.round((Number(apiClover) || 0) * 100) / 100;
  const apiHelcimRounded = Math.round((Number(apiHelcim) || 0) * 100) / 100;
  const excelPos = excelClover == null ? 0 : Math.round(Number(excelClover) * 100) / 100;

  let authorizeNet = Math.round((Number(apiAuthorize) || 0) * 100) / 100;
  if (authorizeNet === 0 && excelAuthorize != null) {
    authorizeNet = Math.round(Number(excelAuthorize) * 100) / 100;
  }

  const useExcelPos = excelPos > apiPos;
  return {
    clover: useExcelPos ? excelPos : apiPos,
    helcim: apiHelcimRounded,
    authorizeNet,
    salesFromExcel: useExcelPos && excelPos > 0,
  };
}

/** Labor % uses ledger total when cash is entered; otherwise channel sales (matches manager dashboard). */
export function computeLaborPercent(laborDollars, totalSales, clover, helcim, authorizeNet) {
  let denominator = null;
  if (totalSales != null && totalSales > 0) {
    denominator = totalSales;
  } else {
    const channel = channelSalesTotal(clover, helcim, authorizeNet);
    if (channel > 0) denominator = channel;
  }
  if (denominator == null || denominator <= 0) return null;
  return Math.round((Number(laborDollars) / denominator) * 1000) / 10;
}

/** Year-sized chunks keep labor/subsidy fetches reliable (vs 40+ monthly edge calls). */
function laborFetchRangesBetween(startDateKey, endDateKey) {
  const ranges = [];
  const startYear = parseInt(startDateKey.slice(0, 4), 10);
  const endYear = parseInt(endDateKey.slice(0, 4), 10);
  for (let year = startYear; year <= endYear; year += 1) {
    const chunkStart = year === startYear ? startDateKey : `${year}-01-01`;
    const chunkEnd = year === endYear ? endDateKey : `${year}-12-31`;
    if (chunkStart <= chunkEnd) ranges.push({ start: chunkStart, end: chunkEnd });
  }
  return ranges;
}

function monthRangesBetween(startDateKey, endDateKey) {
  const ranges = [];
  let [y, m] = startDateKey.split('-').map(Number);
  const [endY, endM, endD] = endDateKey.split('-').map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    const monthStartKey = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEndKey = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const rangeStart = monthStartKey < startDateKey ? startDateKey : monthStartKey;
    const rangeEnd = monthEndKey > endDateKey ? endDateKey : monthEndKey;
    if (rangeStart <= rangeEnd) ranges.push({ start: rangeStart, end: rangeEnd });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return ranges;
}

async function fetchDistinctExternalSalesDays(
  supabase,
  table,
  businessId,
  startUtc,
  endUtc,
  timeZone,
  salesDayEndTime,
) {
  const rows = await fetchAllPages(`${table} event_date`, (from, to) =>
    supabase
      .from(table)
      .select('event_date')
      .eq('business_id', businessId)
      .gte('event_date', startUtc)
      .lte('event_date', endUtc)
      .order('event_date', { ascending: true })
      .range(from, to),
  );
  const days = new Set();
  for (const row of rows) {
    if (!row.event_date) continue;
    days.add(businessDayKeyForIso(String(row.event_date), timeZone, salesDayEndTime));
  }
  return days;
}

function calendarDaysInMonth(monthStartKey) {
  const [y, m] = monthStartKey.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export async function saveManualLaborEntry(supabase, businessId, salesDate, laborDollars, enteredBy) {
  if (laborDollars == null) {
    const { error } = await supabase
      .from('daily_sales_manual_labor')
      .delete()
      .eq('business_id', businessId)
      .eq('sales_date', salesDate);
    if (error) throw new Error(error.message || 'Could not clear labor entry');
    return { laborStatus: 'not_entered', manualLabor: null };
  }

  const rounded = Math.round(Number(laborDollars) * 100) / 100;
  const { error } = await supabase.from('daily_sales_manual_labor').upsert(
    {
      business_id: businessId,
      sales_date: salesDate,
      labor_dollars: rounded,
      entered_by: enteredBy || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'business_id,sales_date' },
  );
  if (error) throw new Error(error.message || 'Could not save labor entry');
  return { laborStatus: 'entered', manualLabor: rounded };
}

export async function fetchExternalSalesCoverageGaps(
  supabase,
  businessId,
  startDateKey,
  endDateKey,
  timeZone,
  salesDayEndTime,
) {
  const ranges = monthRangesBetween(startDateKey, endDateKey);
  const missingMonths = [];
  const partialMonths = [];
  const monthLabels = new Set();

  for (const { start, end } of ranges) {
    const { startUtc, endUtc } = getBusinessDayWindowUtc(start, end, timeZone, salesDayEndTime);
    const monthDays = calendarDaysInMonth(start);
    const [cloverDays, anetDays] = await Promise.all([
      fetchDistinctExternalSalesDays(
        supabase,
        'clover_transactions',
        businessId,
        startUtc,
        endUtc,
        timeZone,
        salesDayEndTime,
      ),
      fetchDistinctExternalSalesDays(
        supabase,
        'authorize_net_transactions',
        businessId,
        startUtc,
        endUtc,
        timeZone,
        salesDayEndTime,
      ),
    ]);

    const cloverStoredDays = cloverDays.size;
    const anetStoredDays = anetDays.size;
    const missingClover = cloverStoredDays === 0;
    const missingAnet = anetStoredDays === 0;
    const partialClover = !missingClover && cloverStoredDays < monthDays;
    const partialAnet = !missingAnet && anetStoredDays < monthDays;

    if (missingClover || missingAnet) {
      missingMonths.push({
        start,
        end,
        label: start.slice(0, 7),
        missingClover,
        missingAnet,
        cloverStoredDays,
        anetStoredDays,
        monthDays,
      });
      monthLabels.add(start.slice(0, 7));
    } else if (partialClover || partialAnet) {
      partialMonths.push({
        start,
        end,
        label: start.slice(0, 7),
        partialClover,
        partialAnet,
        cloverStoredDays,
        anetStoredDays,
        monthDays,
      });
      monthLabels.add(start.slice(0, 7));
    }
  }

  if (missingMonths.length === 0 && partialMonths.length === 0) return null;

  const gapRanges = [...missingMonths, ...partialMonths].sort((a, b) => a.start.localeCompare(b.start));

  return {
    missingMonths,
    partialMonths,
    backfillStart: gapRanges[0].start,
    backfillEnd: gapRanges[gapRanges.length - 1].end,
    monthLabels: [...monthLabels].sort(),
  };
}

export function resolveLaborDollars(clockLabor, manualLabor) {
  if (manualLabor != null) return Math.round(Number(manualLabor) * 100) / 100;
  return Math.round(Number(clockLabor || 0) * 100) / 100;
}

export async function fetchEarliestTimeClockDate(supabase, businessId) {
  const { data, error } = await supabase
    .from('scheduling_time_clocks')
    .select('clock_in_time')
    .eq('business_id', businessId)
    .order('clock_in_time', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[DailySalesLedger] earliest clock query failed', error);
    return null;
  }
  if (!data?.clock_in_time) return null;
  return String(data.clock_in_time).slice(0, 10);
}

export async function fetchManualLaborByDateRange(supabase, businessId, startDateKey, endDateKey) {
  const rows = await fetchAllPages('daily_sales_manual_labor', (from, to) =>
    supabase
      .from('daily_sales_manual_labor')
      .select('sales_date, labor_dollars')
      .eq('business_id', businessId)
      .gte('sales_date', startDateKey)
      .lte('sales_date', endDateKey)
      .order('sales_date', { ascending: true })
      .range(from, to));
  const map = {};
  for (const row of rows) {
    const key = String(row.sales_date).slice(0, 10);
    map[key] = row.labor_dollars == null ? null : Number(row.labor_dollars);
  }
  return map;
}

function applyManualLaborToRows(rows, manualLaborMap = {}) {
  if (Object.keys(manualLaborMap).length === 0) return rows;
  return rows.map((row) => {
    if (!Object.prototype.hasOwnProperty.call(manualLaborMap, row.date)) return row;
    return { ...row, manualLabor: manualLaborMap[row.date] };
  });
}

export async function fetchLaborByDateRange(supabase, businessId, startDateKey, endDateKey) {
  const rangeStart = clampLedgerStartDate(startDateKey);
  if (rangeStart > endDateKey) return { laborByDate: {}, subsidyByDate: {} };
  const ranges = laborFetchRangesBetween(rangeStart, endDateKey);
  const laborByDate = {};
  const subsidyByDate = {};
  let failedChunks = 0;
  for (const { start: chunkStart, end: chunkEnd } of ranges) {
    const { data, error } = await supabase.functions.invoke('daily-sales-ledger', {
      body: {
        action: 'labor_for_range',
        business_id: businessId,
        start_date: chunkStart,
        end_date: chunkEnd,
      },
    });
    if (error || data?.error) {
      failedChunks += 1;
      console.warn(`[DailySalesLedger] labor ${chunkStart}..${chunkEnd} failed`, error || data?.error);
      continue;
    }
    Object.assign(laborByDate, data.laborByDate || {});
    Object.assign(subsidyByDate, data.subsidyByDate || {});
  }
  if (failedChunks > 0) {
    console.warn(
      `[DailySalesLedger] labor/subsidy fetch incomplete: ${failedChunks}/${ranges.length} chunk(s) failed`,
    );
  }
  return { laborByDate, subsidyByDate, fetchFailed: failedChunks > 0 };
}

export function reapplyLaborAndSubsidy(rows, laborByDate = {}, subsidyByDate = {}) {
  return mergeLaborIntoRows(rows, laborByDate, subsidyByDate);
}

export async function fetchLaborAndSubsidyForRange(supabase, businessId, startDateKey, endDateKey) {
  return fetchLaborByDateRange(supabase, businessId, startDateKey, endDateKey);
}

export async function loadLedgerSettings(supabase, businessId) {
  const [{ data: business }, { data: acct }] = await Promise.all([
    supabase.from('businesses').select('timezone').eq('id', businessId).maybeSingle(),
    supabase
      .from('accounting_business_config')
      .select('batch_day_end_time_local')
      .eq('business_id', businessId)
      .maybeSingle(),
  ]);

  const timeZone = business?.timezone || 'America/Toronto';
  let salesDayEndTime = '23:59';
  if (acct?.batch_day_end_time_local) {
    salesDayEndTime = String(acct.batch_day_end_time_local).slice(0, 5);
  }

  return { timeZone, salesDayEndTime };
}

function resolveClockLaborFromFetch(row, laborByDate) {
  const snapshotClock = Number(row.clockLabor ?? 0);
  if (!Object.prototype.hasOwnProperty.call(laborByDate, row.date)) {
    return snapshotClock;
  }
  const fetched = Number(laborByDate[row.date] ?? 0);
  if (fetched > 0) return fetched;
  return snapshotClock > 0 ? snapshotClock : fetched;
}

function resolveLaborDollarsForRow(row, clockLabor) {
  if (row.manualLabor != null) {
    return resolveLaborDollars(clockLabor, row.manualLabor);
  }
  const fromClock = resolveLaborDollars(clockLabor, null);
  if (fromClock > 0) return fromClock;
  return Number(row.laborDollars ?? 0);
}

function resolveSubsidyCredit(row, subsidyByDate, laborDollars) {
  if (Object.prototype.hasOwnProperty.call(subsidyByDate, row.date)) {
    const fetched = Number(subsidyByDate[row.date] ?? 0);
    // Excel/manual payroll days can still receive spread subsidy from pre-punch timesheets.
    if (row.manualLabor != null) return fetched;
    return Math.min(Number(laborDollars ?? 0), fetched);
  }
  // Fresh fetch covers the requested range; missing dates had no subsidy credit.
  if (Object.keys(subsidyByDate).length > 0) return 0;
  return Number(row.subsidyCredit ?? 0);
}

function applySubsidyMetrics(row, subsidyCredit) {
  const laborDollars = Number(row.laborDollars ?? 0);
  // resolveSubsidyCredit already caps clock-day credit; spread subsidy must not be zeroed on $0 payroll days.
  const credit = Math.round(Number(subsidyCredit || 0) * 100) / 100;
  const laborAfterSubsidy = Math.round(Math.max(0, laborDollars - credit) * 100) / 100;
  const laborPercent = computeLaborPercent(
    laborDollars,
    row.totalSales,
    row.clover,
    row.helcim,
    row.authorizeNet,
  );
  const adjustedLaborPercent = computeLaborPercent(
    laborAfterSubsidy,
    row.totalSales,
    row.clover,
    row.helcim,
    row.authorizeNet,
  );
  const profitAfterWages =
    row.totalSales != null ? Math.round((row.totalSales - laborAfterSubsidy) * 100) / 100 : null;
  return {
    subsidyCredit: credit,
    laborAfterSubsidy,
    laborPercent,
    adjustedLaborPercent,
    profitAfterWages,
  };
}

export function mergeLaborIntoRows(rows, laborByDate = {}, subsidyByDate = {}) {
  const updated = rows.map((row) => {
    const manualLabor = row.manualLabor;
    const clockLabor = resolveClockLaborFromFetch(row, laborByDate);
    const laborDollars = resolveLaborDollarsForRow(row, clockLabor);
    const subsidyCredit = resolveSubsidyCredit({ ...row, laborDollars }, subsidyByDate, laborDollars);
    const metrics = applySubsidyMetrics({ ...row, laborDollars }, subsidyCredit);
    return {
      ...row,
      clockLabor,
      laborDollars,
      ...metrics,
      laborSource: manualLabor != null ? 'manual' : laborDollars > 0 ? 'clocks' : 'none',
    };
  });
  return attachRankings(updated);
}

function denseRankByDate(rows) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const rankByDate = {};
  let rank = 0;
  let prev = null;
  for (let i = 0; i < sorted.length; i += 1) {
    if (prev === null || sorted[i].value !== prev) rank = i + 1;
    rankByDate[sorted[i].date] = rank;
    prev = sorted[i].value;
  }
  return rankByDate;
}

export function attachRankings(rows) {
  const complete = rows.filter((r) => r.cashStatus === 'entered' && r.totalSales != null);
  const overallRank = denseRankByDate(complete.map((r) => ({ date: r.date, value: r.totalSales })));
  const profitRank = denseRankByDate(
    complete.filter((r) => r.profitAfterWages != null).map((r) => ({ date: r.date, value: r.profitAfterWages }))
  );

  const years = [...new Set(complete.map((r) => r.date.slice(0, 4)))];
  const yearRankMaps = {};
  for (const year of years) {
    yearRankMaps[year] = denseRankByDate(
      complete.filter((r) => r.date.startsWith(`${year}-`)).map((r) => ({ date: r.date, value: r.totalSales }))
    );
  }

  const monthKeys = [...new Set(complete.map((r) => r.date.slice(0, 7)))];
  const monthRankMaps = {};
  for (const monthKey of monthKeys) {
    monthRankMaps[monthKey] = denseRankByDate(
      complete.filter((r) => r.date.startsWith(`${monthKey}-`)).map((r) => ({ date: r.date, value: r.totalSales }))
    );
  }

  return rows.map((row) => {
    const year = row.date.slice(0, 4);
    const monthKey = row.date.slice(0, 7);
    const isComplete = row.cashStatus === 'entered' && row.totalSales != null;
    return {
      ...row,
      rankOverall: isComplete ? overallRank[row.date] ?? null : null,
      rankThisYear: isComplete ? yearRankMaps[year]?.[row.date] ?? null : null,
      rankProfitOverall: isComplete && row.profitAfterWages != null ? profitRank[row.date] ?? null : null,
      rankThisMonth: isComplete ? monthRankMaps[monthKey]?.[row.date] ?? null : null,
    };
  });
}

export function comparisonMonths(anchorDateKey) {
  const anchorMonth = parseInt(anchorDateKey.slice(5, 7), 10);
  return Array.from({ length: anchorMonth }, (_, i) => i + 1);
}

export function buildMonthlySummary(rows, anchorDateKey = null) {
  const scopedRows = anchorDateKey
    ? rows.filter((row) => {
        const year = parseInt(row.date.slice(0, 4), 10);
        return row.date <= ytdEndKeyForYear(year, anchorDateKey);
      })
    : rows;
  const byKey = {};
  for (const row of scopedRows) {
    const year = parseInt(row.date.slice(0, 4), 10);
    const month = parseInt(row.date.slice(5, 7), 10);
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (!byKey[key]) {
      byKey[key] = {
        year,
        month,
        monthLabel: new Date(year, month - 1, 1).toLocaleDateString('en-CA', { month: 'short' }),
        sales: 0,
        laborDollars: 0,
        subsidyCredit: 0,
        laborAfterSubsidy: 0,
        laborPercent: null,
        adjustedLaborPercent: null,
        dayCount: 0,
        completeDayCount: 0,
      };
    }
    byKey[key].dayCount += 1;
    byKey[key].laborDollars += row.laborDollars;
    byKey[key].subsidyCredit += row.subsidyCredit ?? 0;
    byKey[key].laborAfterSubsidy += row.laborAfterSubsidy ?? row.laborDollars;
    if (row.totalSales != null) {
      byKey[key].sales += row.totalSales;
      byKey[key].completeDayCount += 1;
    }
  }
  return Object.values(byKey)
    .map((cell) => ({
      ...cell,
      sales: Math.round(cell.sales * 100) / 100,
      laborDollars: Math.round(cell.laborDollars * 100) / 100,
      subsidyCredit: Math.round(cell.subsidyCredit * 100) / 100,
      laborAfterSubsidy: Math.round(cell.laborAfterSubsidy * 100) / 100,
      laborPercent: cell.sales > 0 ? Math.round((cell.laborDollars / cell.sales) * 1000) / 10 : null,
      adjustedLaborPercent:
        cell.sales > 0 ? Math.round((cell.laborAfterSubsidy / cell.sales) * 1000) / 10 : null,
    }))
    .sort((a, b) => a.year - b.year || a.month - b.month);
}

export function buildYtdSummary(rows, anchorDateKey, priorYears = 3) {
  const anchorYear = parseInt(anchorDateKey.slice(0, 4), 10);
  const years = [];
  for (let offset = 0; offset <= priorYears; offset += 1) {
    years.push(anchorYear - offset);
  }

  return years.map((year) => {
    const ytdEndKey = ytdEndKeyForYear(year, anchorDateKey);
    const eligible = rows.filter(
      (row) => row.date.startsWith(`${year}-`) && row.date <= ytdEndKey,
    );
    let salesYtd = 0;
    let laborDollarsYtd = 0;
    let subsidyCreditYtd = 0;
    let laborAfterSubsidyYtd = 0;
    let completeDayCount = 0;
    for (const row of eligible) {
      laborDollarsYtd += row.laborDollars;
      subsidyCreditYtd += row.subsidyCredit ?? 0;
      laborAfterSubsidyYtd += row.laborAfterSubsidy ?? row.laborDollars;
      if (row.totalSales != null) {
        salesYtd += row.totalSales;
        completeDayCount += 1;
      }
    }
    return {
      year,
      ytdThrough: ytdEndKey,
      salesYtd: Math.round(salesYtd * 100) / 100,
      laborDollarsYtd: Math.round(laborDollarsYtd * 100) / 100,
      subsidyCreditYtd: Math.round(subsidyCreditYtd * 100) / 100,
      laborAfterSubsidyYtd: Math.round(laborAfterSubsidyYtd * 100) / 100,
      laborPercent: salesYtd > 0 ? Math.round((laborDollarsYtd / salesYtd) * 1000) / 10 : null,
      adjustedLaborPercent:
        salesYtd > 0 ? Math.round((laborAfterSubsidyYtd / salesYtd) * 1000) / 10 : null,
      profitAfterWagesYtd:
        completeDayCount > 0 ? Math.round((salesYtd - laborAfterSubsidyYtd) * 100) / 100 : null,
      completeDayCount,
    };
  });
}

/** Same calendar period as YTD (Jan 1 through anchor month/day each year). */
export function ytdEndKeyForYear(year, anchorDateKey) {
  const anchorYear = parseInt(anchorDateKey.slice(0, 4), 10);
  if (year === anchorYear) return anchorDateKey;
  const month = parseInt(anchorDateKey.slice(5, 7), 10);
  const day = parseInt(anchorDateKey.slice(8, 10), 10);
  const lastDay = new Date(year, month, 0).getDate();
  const clampedDay = Math.min(day, lastDay);
  return `${year}-${String(month).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export function sumMonthlyRowTotal(monthlySummary, year) {
  return Math.round(
    monthlySummary
      .filter((cell) => cell.year === year)
      .reduce((sum, cell) => sum + (cell.sales || 0), 0) * 100,
  ) / 100;
}

/** Earliest date with meaningful OTWK sales/labor data. */
export const LEDGER_EARLIEST_DATA_START = '2020-02-15';

export function clampLedgerStartDate(dateKey) {
  return dateKey < LEDGER_EARLIEST_DATA_START ? LEDGER_EARLIEST_DATA_START : dateKey;
}

export function ytdComparisonStart(anchorDateKey, priorYears = 3) {
  const anchorYear = parseInt(anchorDateKey.slice(0, 4), 10);
  return clampLedgerStartDate(`${anchorYear - priorYears}-01-01`);
}

/** Jan 1 of the earliest year to load for full-calendar annual totals. */
export function annualSummaryStart(asOfDateKey, earliestDateKey = null) {
  let calculatedStart;
  if (earliestDateKey) {
    calculatedStart = `${earliestDateKey.slice(0, 4)}-01-01`;
  } else {
    const asOfYear = parseInt(asOfDateKey.slice(0, 4), 10);
    calculatedStart = `${asOfYear - 5}-01-01`;
  }
  return clampLedgerStartDate(calculatedStart);
}

/** Only recent days need live clock-labor refresh; snapshots cover history. */
export function laborRefreshStart(endDateKey, refreshDays = 14) {
  const end = new Date(`${endDateKey}T12:00:00`);
  end.setDate(end.getDate() - refreshDays);
  return clampLedgerStartDate(end.toISOString().slice(0, 10));
}

/** Dec 31 for completed years; as-of date for the current calendar year. */
export function annualEndKeyForYear(year, asOfDateKey) {
  const asOfYear = parseInt(asOfDateKey.slice(0, 4), 10);
  if (year < asOfYear) return `${year}-12-31`;
  return asOfDateKey;
}

export function buildAnnualSummary(rows, asOfDateKey) {
  const asOfYear = parseInt(asOfDateKey.slice(0, 4), 10);
  const years = [...new Set(rows.map((row) => parseInt(row.date.slice(0, 4), 10)))]
    .filter((year) => year <= asOfYear)
    .sort((a, b) => b - a);

  return years.map((year) => {
    const periodStart = `${year}-01-01`;
    const periodEnd = annualEndKeyForYear(year, asOfDateKey);
    const eligible = rows.filter((row) => row.date >= periodStart && row.date <= periodEnd);
    let salesAnnual = 0;
    let laborDollarsAnnual = 0;
    let subsidyCreditAnnual = 0;
    let laborAfterSubsidyAnnual = 0;
    let completeDayCount = 0;
    for (const row of eligible) {
      laborDollarsAnnual += row.laborDollars;
      subsidyCreditAnnual += row.subsidyCredit ?? 0;
      laborAfterSubsidyAnnual += row.laborAfterSubsidy ?? row.laborDollars;
      if (row.totalSales != null) {
        salesAnnual += row.totalSales;
        completeDayCount += 1;
      }
    }
    return {
      year,
      periodStart,
      periodEnd,
      isPartialYear: year === asOfYear,
      salesAnnual: Math.round(salesAnnual * 100) / 100,
      laborDollarsAnnual: Math.round(laborDollarsAnnual * 100) / 100,
      subsidyCreditAnnual: Math.round(subsidyCreditAnnual * 100) / 100,
      laborAfterSubsidyAnnual: Math.round(laborAfterSubsidyAnnual * 100) / 100,
      laborPercent: salesAnnual > 0 ? Math.round((laborDollarsAnnual / salesAnnual) * 1000) / 10 : null,
      adjustedLaborPercent:
        salesAnnual > 0 ? Math.round((laborAfterSubsidyAnnual / salesAnnual) * 1000) / 10 : null,
      profitAfterWages:
        completeDayCount > 0 ? Math.round((salesAnnual - laborAfterSubsidyAnnual) * 100) / 100 : null,
      completeDayCount,
    };
  });
}

export function applyManualCashToRow(row, manualCash) {
  const cashStatus = manualCash == null ? 'not_entered' : 'entered';
  const totalSales = resolveTotalSales(row.clover, row.helcim, row.authorizeNet, manualCash);
  const metrics = applySubsidyMetrics({ ...row, totalSales }, row.subsidyCredit ?? 0);
  return {
    ...row,
    manualCash,
    cashStatus,
    totalSales,
    ...metrics,
  };
}

export function emptyLedgerShellRow(date) {
  const d = new Date(`${date}T12:00:00`);
  return {
    date,
    label: d.toLocaleDateString('en-CA', { weekday: 'short' }),
    clover: 0,
    helcim: 0,
    authorizeNet: 0,
    helcimCashInSystem: 0,
    cloverCashInSystem: 0,
    salesFromExcel: false,
    manualCash: null,
    manualLabor: null,
    cashStatus: 'not_entered',
    totalSales: null,
    clockLabor: 0,
    laborDollars: 0,
    subsidyCredit: 0,
    laborAfterSubsidy: 0,
    laborPercent: null,
    adjustedLaborPercent: null,
    profitAfterWages: null,
    laborSource: 'none',
    rankOverall: null,
    rankThisYear: null,
    rankProfitOverall: null,
    rankThisMonth: null,
  };
}

export function rowHasLedgerData(row) {
  return (
    row.totalSales != null
    || row.clover !== 0
    || row.helcim !== 0
    || row.authorizeNet !== 0
    || row.manualCash != null
    || row.manualLabor != null
    || (row.clockLabor ?? 0) > 0
  );
}

export function ledgerSnapshotToRow(record) {
  const date = String(record.sales_date).slice(0, 10);
  const manualCash = record.manual_cash == null ? null : Number(record.manual_cash);
  const manualLabor = record.manual_labor == null ? null : Number(record.manual_labor);
  const d = new Date(`${date}T12:00:00`);
  return {
    date,
    label: d.toLocaleDateString('en-CA', { weekday: 'short' }),
    clover: Number(record.clover) || 0,
    helcim: Number(record.helcim) || 0,
    authorizeNet: Number(record.authorize_net) || 0,
    helcimCashInSystem: Number(record.helcim_cash_in_system) || 0,
    cloverCashInSystem: Number(record.clover_cash_in_system) || 0,
    salesFromExcel: !!record.sales_from_excel,
    manualCash,
    manualLabor,
    cashStatus: manualCash == null ? 'not_entered' : 'entered',
    totalSales: record.total_sales == null ? null : Number(record.total_sales),
    clockLabor: Number(record.clock_labor) || 0,
    laborDollars: Number(record.labor_dollars) || 0,
    laborPercent: record.labor_percent == null ? null : Number(record.labor_percent),
    profitAfterWages: record.profit_after_wages == null ? null : Number(record.profit_after_wages),
    laborSource: record.labor_source || 'none',
    rankOverall: null,
    rankThisYear: null,
    rankProfitOverall: null,
    rankThisMonth: null,
  };
}

export function rowToLedgerSnapshotPayload(businessId, row) {
  return {
    business_id: businessId,
    sales_date: row.date,
    clover: row.clover,
    helcim: row.helcim,
    authorize_net: row.authorizeNet,
    manual_cash: row.manualCash,
    manual_labor: row.manualLabor,
    clock_labor: row.clockLabor ?? 0,
    total_sales: row.totalSales,
    labor_dollars: row.laborDollars ?? 0,
    labor_percent: row.laborPercent,
    profit_after_wages: row.profitAfterWages,
    helcim_cash_in_system: row.helcimCashInSystem ?? 0,
    clover_cash_in_system: row.cloverCashInSystem ?? 0,
    sales_from_excel: !!row.salesFromExcel,
    labor_source: row.laborSource ?? 'none',
    computed_at: new Date().toISOString(),
  };
}

export async function fetchLedgerDaySnapshots(supabase, businessId, startDateKey, endDateKey) {
  return fetchAllPages('daily_sales_ledger_days', (from, to) =>
    supabase
      .from('daily_sales_ledger_days')
      .select('*')
      .eq('business_id', businessId)
      .gte('sales_date', startDateKey)
      .lte('sales_date', endDateKey)
      .order('sales_date', { ascending: true })
      .range(from, to));
}

export async function upsertLedgerDaySnapshots(supabase, businessId, rows) {
  const payloads = rows.filter(rowHasLedgerData).map((row) => rowToLedgerSnapshotPayload(businessId, row));
  if (payloads.length === 0) return;
  for (let i = 0; i < payloads.length; i += 500) {
    const chunk = payloads.slice(i, i + 500);
    const { error } = await supabase
      .from('daily_sales_ledger_days')
      .upsert(chunk, { onConflict: 'business_id,sales_date' });
    if (error) throw new Error(error.message || 'Could not save ledger day snapshots');
  }
}

export async function refreshLedgerDaySnapshot(
  supabase,
  businessId,
  salesDateKey,
  timeZone,
  salesDayEndTime,
  laborByDate = {},
) {
  const rows = await loadSalesLedgerRowsLive(
    supabase,
    businessId,
    salesDateKey,
    salesDateKey,
    timeZone,
    salesDayEndTime,
    laborByDate,
  );
  const row = rows[0];
  if (!row || !rowHasLedgerData(row)) {
    await supabase
      .from('daily_sales_ledger_days')
      .delete()
      .eq('business_id', businessId)
      .eq('sales_date', salesDateKey);
    return null;
  }
  await upsertLedgerDaySnapshots(supabase, businessId, [row]);
  return row;
}

/** Days with entered additional cash / excel keep those fields, but channel totals still refresh. */
export function isSalesDayLocked(row) {
  if (!row) return false;
  if (row.salesFromExcel) return true;
  return row.manualCash != null && row.cashStatus === 'entered';
}

export async function rebuildLedgerDaySnapshotsForRange(supabase, businessId, startDateKey, endDateKey) {
  const ranges = monthRangesBetween(startDateKey, endDateKey);
  let cachedDays = 0;
  for (const { start, end } of ranges) {
    const { data, error } = await supabase.functions.invoke('daily-sales-ledger', {
      body: {
        action: 'rebuild_ledger_days',
        business_id: businessId,
        start_date: start,
        end_date: end,
      },
    });
    if (error) throw new Error(error.message || 'Ledger snapshot rebuild failed');
    if (data?.error) throw new Error(data.error);
    cachedDays += data?.cachedDays || 0;
  }
  return { cachedDays };
}

export async function loadSalesLedgerRows(
  supabase,
  businessId,
  startDateKey,
  endDateKey,
  timeZone,
  salesDayEndTime,
  laborByDate = {},
  options = {},
) {
  const { fillCalendarDays = true, preferSnapshots = true, subsidyByDate = {} } = options;

  if (preferSnapshots) {
    try {
      const [snapshots, manualLaborMap] = await Promise.all([
        fetchLedgerDaySnapshots(supabase, businessId, startDateKey, endDateKey),
        fetchManualLaborByDateRange(supabase, businessId, startDateKey, endDateKey),
      ]);
      if (snapshots.length > 0) {
        let snapshotRows = applyManualLaborToRows(
          snapshots.map(ledgerSnapshotToRow),
          manualLaborMap,
        );
        // Recompute channel totals for the full viewed range from source tables.
        // Stale snapshots previously forced Clover=0 whenever Helcim existed; do not keep those.
        let laborForRange = laborByDate;
        const hasRangeLabor = Object.keys(laborByDate).some(
          (date) => date >= startDateKey && date <= endDateKey,
        );
        if (!hasRangeLabor) {
          const fetched = await fetchLaborByDateRange(
            supabase,
            businessId,
            clampLedgerStartDate(startDateKey),
            endDateKey,
          );
          laborForRange = { ...laborByDate, ...fetched.laborByDate };
        }
        const liveRows = await loadSalesLedgerRowsLive(
          supabase,
          businessId,
          startDateKey,
          endDateKey,
          timeZone,
          salesDayEndTime,
          laborForRange,
        );
        const snapshotByDate = Object.fromEntries(snapshotRows.map((row) => [row.date, row]));
        const mergedLiveRows = liveRows.map((live) => {
          const snap = snapshotByDate[live.date];
          if (snap && isSalesDayLocked(snap)) {
            return applyManualCashToRow(
              {
                ...live,
                laborDollars: snap.laborDollars ?? live.laborDollars,
                laborSource: snap.laborSource ?? live.laborSource,
                subsidyCredit: snap.subsidyCredit ?? live.subsidyCredit ?? 0,
                salesFromExcel: snap.salesFromExcel || live.salesFromExcel,
              },
              snap.manualCash,
            );
          }
          return live;
        });
        if (mergedLiveRows.length > 0) {
          await upsertLedgerDaySnapshots(supabase, businessId, mergedLiveRows);
          snapshotRows = mergedLiveRows.sort((a, b) => a.date.localeCompare(b.date));
        }

        const merged = mergeLaborIntoRows(snapshotRows, laborByDate, subsidyByDate);
        if (!fillCalendarDays) {
          return merged;
        }
        const days = dateKeysBetween(startDateKey, endDateKey);
        const byDate = Object.fromEntries(merged.map((row) => [row.date, row]));
        return attachRankings(days.map((date) => byDate[date] || emptyLedgerShellRow(date)));
      }
    } catch (e) {
      console.warn('[loadSalesLedgerRows] snapshot read failed, using live aggregation', e);
    }
  }

  const liveRows = mergeLaborIntoRows(
    await loadSalesLedgerRowsLive(
      supabase,
      businessId,
      startDateKey,
      endDateKey,
      timeZone,
      salesDayEndTime,
      laborByDate,
    ),
    laborByDate,
    subsidyByDate,
  );
  upsertLedgerDaySnapshots(supabase, businessId, liveRows).catch((err) => {
    console.warn('[loadSalesLedgerRows] snapshot write failed', err);
  });
  if (!fillCalendarDays) {
    return liveRows.filter(rowHasLedgerData);
  }
  return liveRows;
}

async function loadSalesLedgerRowsLive(supabase, businessId, startDateKey, endDateKey, timeZone, salesDayEndTime, laborByDate = {}) {
  const days = dateKeysBetween(startDateKey, endDateKey);
  const { startUtc, endUtc } = getBusinessDayWindowUtc(startDateKey, endDateKey, timeZone, salesDayEndTime);
  const daySet = new Set(days);

  const byDay = {};
  for (const d of days) {
    byDay[d] = { posGross: 0, posRefunds: 0, helcimCash: 0, authorizeNet: 0, clover: 0, cloverCash: 0 };
  }

  const [sales, refunds, payments, anetRows, cloverRows, manualCashRows, manualLaborRows, excelChannelRows] = await Promise.all([
    fetchAllPages('pos_sales', (from, to) =>
      supabase
        .from('pos_sales')
        .select('id, total, payment_status, created_at')
        .eq('business_id', businessId)
        .gte('created_at', startUtc)
        .lte('created_at', endUtc)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
    fetchAllPages('pos_refunds', (from, to) =>
      supabase
        .from('pos_refunds')
        .select('id, total_refund_amount, refund_method, created_at')
        .eq('business_id', businessId)
        .gte('created_at', startUtc)
        .lte('created_at', endUtc)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
    fetchAllPages('pos_payments', (from, to) =>
      supabase
        .from('pos_payments')
        .select('id, amount, payment_method, notes, created_at')
        .eq('business_id', businessId)
        .gte('created_at', startUtc)
        .lte('created_at', endUtc)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
    fetchAllPages('authorize_net_transactions', (from, to) =>
      supabase
        .from('authorize_net_transactions')
        .select('id, amount, status, transaction_kind, event_date, created_at')
        .eq('business_id', businessId)
        .gte('event_date', startUtc)
        .lte('event_date', endUtc)
        .order('event_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
    fetchAllPages('clover_transactions', (from, to) =>
      supabase
        .from('clover_transactions')
        .select('id, amount, status, transaction_kind, event_date, created_at, result')
        .eq('business_id', businessId)
        .gte('event_date', startUtc)
        .lte('event_date', endUtc)
        .order('event_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
    fetchAllPages('daily_sales_manual_cash', (from, to) =>
      supabase
        .from('daily_sales_manual_cash')
        .select('sales_date, cash_collected')
        .eq('business_id', businessId)
        .gte('sales_date', startDateKey)
        .lte('sales_date', endDateKey)
        .order('sales_date', { ascending: true })
        .range(from, to)),
    fetchAllPages('daily_sales_manual_labor', (from, to) =>
      supabase
        .from('daily_sales_manual_labor')
        .select('sales_date, labor_dollars')
        .eq('business_id', businessId)
        .gte('sales_date', startDateKey)
        .lte('sales_date', endDateKey)
        .order('sales_date', { ascending: true })
        .range(from, to)),
    fetchAllPages('daily_sales_excel_channels', (from, to) =>
      supabase
        .from('daily_sales_excel_channels')
        .select('sales_date, clover, authorize_net')
        .eq('business_id', businessId)
        .gte('sales_date', startDateKey)
        .lte('sales_date', endDateKey)
        .order('sales_date', { ascending: true })
        .range(from, to)),
  ]);

  const manualCashMap = {};
  for (const row of manualCashRows) {
    const key = String(row.sales_date).slice(0, 10);
    manualCashMap[key] = row.cash_collected == null ? null : Number(row.cash_collected);
  }

  const manualLaborMap = {};
  for (const row of manualLaborRows) {
    const key = String(row.sales_date).slice(0, 10);
    manualLaborMap[key] = row.labor_dollars == null ? null : Number(row.labor_dollars);
  }

  const excelChannelMap = {};
  for (const row of excelChannelRows) {
    const key = String(row.sales_date).slice(0, 10);
    excelChannelMap[key] = {
      clover: row.clover == null ? null : Number(row.clover),
      authorizeNet: row.authorize_net == null ? null : Number(row.authorize_net),
    };
  }

  for (const sale of sales) {
    if (sale.payment_status !== 'paid' && sale.payment_status !== 'completed') continue;
    const key = businessDayKeyForIso(String(sale.created_at), timeZone, salesDayEndTime);
    if (!daySet.has(key)) continue;
    byDay[key].posGross += Number(sale.total) || 0;
  }

  for (const refund of refunds) {
    const key = businessDayKeyForIso(String(refund.created_at), timeZone, salesDayEndTime);
    if (!daySet.has(key)) continue;
    const amount = Number(refund.total_refund_amount) || 0;
    byDay[key].posRefunds += amount;
    if (posRefundTenderCategory(refund.refund_method) === 'cash') byDay[key].helcimCash -= amount;
  }

  for (const payment of payments) {
    const key = businessDayKeyForIso(String(payment.created_at), timeZone, salesDayEndTime);
    if (!daySet.has(key)) continue;
    if (posPaymentTenderCategory(payment.payment_method, payment.notes) === 'cash') {
      byDay[key].helcimCash += Number(payment.amount) || 0;
    }
  }

  for (const row of anetRows) {
    const ts = row.event_date || row.created_at;
    if (!ts) continue;
    const key = businessDayKeyForIso(String(ts), timeZone, salesDayEndTime);
    if (!daySet.has(key)) continue;
    byDay[key].authorizeNet += authorizeNetSignedAmount(row);
  }

  for (const row of cloverRows) {
    const ts = row.event_date || row.created_at;
    if (!ts) continue;
    const key = businessDayKeyForIso(String(ts), timeZone, salesDayEndTime);
    if (!daySet.has(key)) continue;
    const signed = cloverSignedAmount(row);
    if (!signed) continue;
    byDay[key].clover += signed;
    // Clover cash subtract requires tender metadata; skip on client bulk load (cloverCash stays 0).
  }

  const coreRows = days.map((date) => {
    const row = byDay[date];
    const apiClover = Math.round(row.clover * 100) / 100;
    const apiAuthorize = Math.round(row.authorizeNet * 100) / 100;
    const apiHelcim = Math.round((row.posGross - row.posRefunds) * 100) / 100;
    const excel = excelChannelMap[date];
    const resolved = resolveChannelSalesForDay({
      apiClover,
      apiHelcim,
      apiAuthorize,
      excelClover: excel?.clover ?? null,
      excelAuthorize: excel?.authorizeNet ?? null,
    });

    return {
      date,
      clover: resolved.clover,
      helcim: resolved.helcim,
      authorizeNet: resolved.authorizeNet,
      helcimCashInSystem: Math.round(row.helcimCash * 100) / 100,
      cloverCashInSystem: Math.round(row.cloverCash * 100) / 100,
      salesFromExcel: resolved.salesFromExcel,
    };
  });

  const rows = coreRows.map((core) => {
    const manualCash = Object.prototype.hasOwnProperty.call(manualCashMap, core.date) ? manualCashMap[core.date] : null;
    const manualLabor = Object.prototype.hasOwnProperty.call(manualLaborMap, core.date) ? manualLaborMap[core.date] : null;
    const cashStatus = manualCash == null ? 'not_entered' : 'entered';
    const totalSales = resolveTotalSales(core.clover, core.helcim, core.authorizeNet, manualCash);
    const clockLabor = laborByDate[core.date] ?? 0;
    const laborDollars = resolveLaborDollars(clockLabor, manualLabor);
    const laborPercent = computeLaborPercent(
      laborDollars,
      totalSales,
      core.clover,
      core.helcim,
      core.authorizeNet,
    );
    const profitAfterWages = totalSales != null ? Math.round((totalSales - laborDollars) * 100) / 100 : null;
    const d = new Date(`${core.date}T12:00:00`);
    return {
      ...core,
      label: d.toLocaleDateString('en-CA', { weekday: 'short' }),
      manualCash,
      manualLabor,
      cashStatus,
      totalSales,
      clockLabor,
      laborDollars,
      laborPercent,
      profitAfterWages,
      laborSource: manualLabor != null ? 'manual' : clockLabor > 0 ? 'clocks' : 'none',
      rankOverall: null,
      rankThisYear: null,
      rankProfitOverall: null,
      rankThisMonth: null,
    };
  });

  return attachRankings(rows);
}
