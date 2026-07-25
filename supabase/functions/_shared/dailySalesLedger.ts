import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import dayjs from 'https://esm.sh/dayjs@1.11.10'
import utc from 'https://esm.sh/dayjs@1.11.10/plugin/utc'
import timezone from 'https://esm.sh/dayjs@1.11.10/plugin/timezone'
import { collectPaymentsForSyncDate, fetchCloverTenders } from './cloverApi.ts'
import { getCloverCredentialsForBusiness } from './cloverBusinessCredentials.ts'
import { upsertCloverTransactionRow } from './cloverTransactionStore.ts'
import {
  collectTransactionsForSyncDate,
  fetchAuthorizeNetTransactionDetails,
} from './authorizeNetApi.ts'
import { getAuthorizeNetCredentialsForBusiness } from './authorizeNetBusinessCredentials.ts'
import { upsertAuthorizeNetTransactionRow } from './authorizeNetTransactionStore.ts'
import {
  accumulateLaborAndSubsidyByDate,
  applyPeriodHoursSpreadSubsidy,
  applyTimesheetSpreadSubsidy,
  parseSubsidyConfig,
  premiumPerHourFromAssignments,
  shiftPaidHours,
  weekStartSundayKey,
  type PeriodHoursLineRow,
  type ClockLaborRow,
  type TimesheetShiftRow,
} from './laborSubsidyCalc.ts'

dayjs.extend(utc)
dayjs.extend(timezone)

const SUPABASE_PAGE_SIZE = 1000

export type DailySalesRow = {
  date: string
  label: string
  clover: number
  helcim: number
  authorizeNet: number
  helcimCashInSystem: number
  cloverCashInSystem: number
  manualCash: number | null
  cashStatus: 'not_entered' | 'entered'
  totalSales: number | null
  laborDollars: number
  laborPercent: number | null
  profitAfterWages: number | null
  rankOverall: number | null
  rankThisYear: number | null
  rankProfitOverall: number | null
  rankThisMonth: number | null
  salesFromExcel?: boolean
}

export type MonthlySummaryCell = {
  year: number
  month: number
  monthLabel: string
  sales: number
  laborDollars: number
  laborPercent: number | null
  dayCount: number
  completeDayCount: number
}

export type YtdSummaryRow = {
  year: number
  ytdThrough: string
  salesYtd: number
  laborDollarsYtd: number
  laborPercent: number | null
  profitAfterWagesYtd: number | null
  completeDayCount: number
}

function parseDayEndTime(raw: string | null | undefined): { hour: number; minute: number } {
  if (!raw) return { hour: 23, minute: 59 }
  const parts = String(raw).trim().split(':')
  return {
    hour: parseInt(parts[0] || '23', 10) || 0,
    minute: parseInt(parts[1] || '59', 10) || 0,
  }
}

function usesCalendarDayCutoff(dayEnd: { hour: number; minute: number }): boolean {
  return dayEnd.hour >= 23 && dayEnd.minute >= 59
}

export function businessDayKeyForIso(iso: string, tz: string, salesDayEndTime: string): string {
  const dayEnd = parseDayEndTime(salesDayEndTime)
  if (usesCalendarDayCutoff(dayEnd)) {
    return dayjs(iso).tz(tz).format('YYYY-MM-DD')
  }
  const local = dayjs(iso).tz(tz)
  const minutes = local.hour() * 60 + local.minute()
  const endMinutes = dayEnd.hour * 60 + dayEnd.minute
  if (minutes > endMinutes) {
    return local.add(1, 'day').format('YYYY-MM-DD')
  }
  return local.format('YYYY-MM-DD')
}

export function getBusinessDayWindowUtc(
  businessDateKey: string,
  tz: string,
  salesDayEndTime: string,
): { startUtc: string; endUtc: string } {
  const dayEnd = parseDayEndTime(salesDayEndTime)
  if (usesCalendarDayCutoff(dayEnd)) {
    return {
      startUtc: dayjs.tz(`${businessDateKey}T00:00:00`, tz).toISOString(),
      endUtc: dayjs.tz(`${businessDateKey}T23:59:59.999`, tz).toISOString(),
    }
  }

  const prevKey = dayjs.tz(`${businessDateKey}T12:00:00`, tz).subtract(1, 'day').format('YYYY-MM-DD')
  const endH = String(dayEnd.hour).padStart(2, '0')
  const endM = String(dayEnd.minute).padStart(2, '0')
  return {
    startUtc: dayjs.tz(`${prevKey}T${endH}:${endM}:01`, tz).toISOString(),
    endUtc: dayjs.tz(`${businessDateKey}T${endH}:${endM}:59.999`, tz).toISOString(),
  }
}

export async function loadSalesDayEndTime(
  admin: SupabaseClient,
  businessId: string,
): Promise<string> {
  const { data: acct } = await admin
    .from('accounting_business_config')
    .select('batch_day_end_time_local')
    .eq('business_id', businessId)
    .maybeSingle()

  if (acct?.batch_day_end_time_local) {
    const parts = parseDayEndTime(String(acct.batch_day_end_time_local))
    return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
  }

  const { data: clover } = await admin
    .from('business_clover_credentials')
    .select('business_id')
    .eq('business_id', businessId)
    .maybeSingle()

  if (clover?.business_id) return '20:00'

  return '23:59'
}

export async function loadBusinessTimezone(
  admin: SupabaseClient,
  businessId: string,
): Promise<string> {
  const { data } = await admin
    .from('businesses')
    .select('timezone')
    .eq('id', businessId)
    .maybeSingle()
  return data?.timezone || 'America/Toronto'
}

async function fetchAllPaged<T>(
  queryFn: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await queryFn(from, from + SUPABASE_PAGE_SIZE - 1)
    if (error) throw error
    const batch = data || []
    rows.push(...batch)
    if (batch.length < SUPABASE_PAGE_SIZE) break
    from += SUPABASE_PAGE_SIZE
  }
  return rows
}

function normalizeTenderCategory(label: string, labelKey = ''): string {
  const combined = `${labelKey} ${label}`.toLowerCase()
  if (combined.includes('cash')) return 'cash'
  if (combined.includes('debit') || combined.includes('interac')) return 'debit'
  if (
    combined.includes('credit') ||
    combined.includes('card') ||
    combined.includes('visa') ||
    combined.includes('master') ||
    combined.includes('amex')
  ) {
    return 'credit'
  }
  return 'other'
}

function posPaymentTenderCategory(method: string, notes: string | null): string {
  const m = String(method || '').toLowerCase()
  if (m === 'cash') return 'cash'
  if (m === 'debit') return 'debit'
  if (m === 'card' || m === 'credit' || m === 'helcim_terminal' || m === 'helcim') return 'credit'
  return 'credit'
}

function posRefundTenderCategory(method: string | null): string {
  const m = String(method || 'cash').toLowerCase()
  if (m === 'cash') return 'cash'
  if (m === 'debit') return 'debit'
  if (m === 'card' || m === 'credit' || m === 'helcim_terminal' || m === 'helcim') return 'credit'
  return 'credit'
}

function cloverTenderKeyFromRaw(
  raw: Record<string, unknown> | null,
  cloverTenderMap: Record<string, { label: string; labelKey: string }>,
): string {
  const tenderRef = raw?.tender as Record<string, unknown> | undefined
  const tenderId = tenderRef?.id ? String(tenderRef.id) : ''

  if (tenderRef?.label || tenderRef?.labelKey) {
    return normalizeTenderCategory(
      String(tenderRef.label || ''),
      String(tenderRef.labelKey || ''),
    )
  }

  if (tenderId && cloverTenderMap[tenderId]) {
    return normalizeTenderCategory(
      cloverTenderMap[tenderId].label,
      cloverTenderMap[tenderId].labelKey,
    )
  }

  if (raw?.cashTendered || raw?.cashTender) return 'cash'

  const cardTx = raw?.cardTransaction as Record<string, unknown> | undefined
  if (cardTx?.cardType) {
    return normalizeTenderCategory(String(cardTx.cardType), String(cardTx.cardType))
  }

  return 'other'
}

function cloverSignedAmount(row: Record<string, unknown>): number {
  const amount = Math.abs(Number(row.amount) || 0)
  if (amount <= 0) return 0

  const kind = String(row.transaction_kind || '').toLowerCase()
  const status = String(row.status || '').toLowerCase()
  const result = String(row.result || '').toUpperCase()

  if (kind === 'refund') return -amount
  if (kind === 'void' || status.includes('void')) return 0
  if (result === 'FAIL' || result === 'FAILED' || status.includes('declin')) return 0

  return amount
}

function authorizeNetSignedAmount(row: Record<string, unknown>): number {
  const amount = Math.abs(Number(row.amount) || 0)
  if (amount <= 0) return 0

  const kind = String(row.transaction_kind || '').toLowerCase()
  const status = String(row.status || '').toLowerCase()

  if (kind === 'refund') return -amount
  if (kind === 'void' || status.includes('void')) return 0
  if (status.includes('declin') || status === 'declined') return 0
  if (status.includes('held') && !status.includes('captured')) return 0

  return amount
}

/** manualCash = additional cash only (not already in Clover, Helcim, or Authorize.net). */
export function computeTotalSales(
  clover: number,
  helcim: number,
  authorizeNet: number,
  manualCash: number | null,
  _helcimCashInSystem?: number,
  _cloverCashInSystem?: number,
): number | null {
  if (manualCash == null) return null
  const total = clover + helcim + authorizeNet + manualCash
  return Math.round(total * 100) / 100
}

export function channelSalesTotal(clover: number, helcim: number, authorizeNet: number): number {
  return Math.round((Number(clover) + Number(helcim) + Number(authorizeNet)) * 100) / 100
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
}: {
  apiClover?: number
  apiHelcim?: number
  apiAuthorize?: number
  excelClover?: number | null
  excelAuthorize?: number | null
}): { clover: number; helcim: number; authorizeNet: number; salesFromExcel: boolean } {
  const apiPos = Math.round((Number(apiClover) || 0) * 100) / 100
  const apiHelcimRounded = Math.round((Number(apiHelcim) || 0) * 100) / 100
  const excelPos = excelClover == null ? 0 : Math.round(Number(excelClover) * 100) / 100

  let authorizeNet = Math.round((Number(apiAuthorize) || 0) * 100) / 100
  if (authorizeNet === 0 && excelAuthorize != null) {
    authorizeNet = Math.round(Number(excelAuthorize) * 100) / 100
  }

  const useExcelPos = excelPos > apiPos
  return {
    clover: useExcelPos ? excelPos : apiPos,
    helcim: apiHelcimRounded,
    authorizeNet,
    salesFromExcel: useExcelPos && excelPos > 0,
  }
}

export function resolveTotalSales(
  clover: number,
  helcim: number,
  authorizeNet: number,
  manualCash: number | null,
): number | null {
  if (manualCash != null) {
    return computeTotalSales(clover, helcim, authorizeNet, manualCash)
  }
  const channel = channelSalesTotal(clover, helcim, authorizeNet)
  if (channel > 0) return channel
  return null
}

export function computeLaborPercent(
  laborDollars: number,
  totalSales: number | null,
  clover: number,
  helcim: number,
  authorizeNet: number,
): number | null {
  let denominator: number | null = null
  if (totalSales != null && totalSales > 0) {
    denominator = totalSales
  } else {
    const channel = Math.round((clover + helcim + authorizeNet) * 100) / 100
    if (channel > 0) denominator = channel
  }
  if (denominator == null || denominator <= 0) return null
  return Math.round((laborDollars / denominator) * 1000) / 10
}

function dateKeysBetween(startDateKey: string, endDateKey: string, tz: string): string[] {
  const start = dayjs.tz(`${startDateKey}T12:00:00`, tz)
  const end = dayjs.tz(`${endDateKey}T12:00:00`, tz)
  const dayCount = end.diff(start, 'day') + 1
  if (dayCount <= 0) return []

  const days: string[] = []
  for (let i = 0; i < dayCount; i += 1) {
    days.push(start.add(i, 'day').format('YYYY-MM-DD'))
  }
  return days
}

export async function loadManualCashMap(
  admin: SupabaseClient,
  businessId: string,
  startDateKey: string,
  endDateKey: string,
): Promise<Record<string, number | null>> {
  const { data, error } = await admin
    .from('daily_sales_manual_cash')
    .select('sales_date, cash_collected')
    .eq('business_id', businessId)
    .gte('sales_date', startDateKey)
    .lte('sales_date', endDateKey)

  if (error) throw error

  const map: Record<string, number | null> = {}
  for (const row of data || []) {
    const key = String(row.sales_date).slice(0, 10)
    map[key] = row.cash_collected == null ? null : Number(row.cash_collected)
  }
  return map
}

type DailySalesCoreOptions = {
  /** When true, emit every calendar day in range (for ledger display). When false, only days with activity. */
  fillCalendarDays?: boolean
}

export async function loadDailySalesCore(
  admin: SupabaseClient,
  businessId: string,
  tz: string,
  startDateKey: string,
  endDateKey: string,
  salesDayEndTime: string,
  options: DailySalesCoreOptions = {},
) {
  const fillCalendarDays = options.fillCalendarDays ?? false
  const calendarDays = fillCalendarDays ? dateKeysBetween(startDateKey, endDateKey, tz) : []
  if (fillCalendarDays && calendarDays.length === 0) return []

  const rangeStart = getBusinessDayWindowUtc(startDateKey, tz, salesDayEndTime).startUtc
  const rangeEnd = getBusinessDayWindowUtc(endDateKey, tz, salesDayEndTime).endUtc
  const daySet = fillCalendarDays ? new Set(calendarDays) : null

  const byDay: Record<
    string,
    {
      posGross: number
      posRefunds: number
      helcimCash: number
      authorizeNet: number
      clover: number
      cloverCash: number
    }
  > = {}

  if (fillCalendarDays) {
    for (const d of calendarDays) {
      byDay[d] = { posGross: 0, posRefunds: 0, helcimCash: 0, authorizeNet: 0, clover: 0, cloverCash: 0 }
    }
  }

  const ensureDay = (key: string) => {
    if (!byDay[key]) {
      byDay[key] = { posGross: 0, posRefunds: 0, helcimCash: 0, authorizeNet: 0, clover: 0, cloverCash: 0 }
    }
  }

  const includeDay = (key: string) => {
    if (key < startDateKey || key > endDateKey) return false
    if (daySet) return daySet.has(key)
    return true
  }

  const sales = await fetchAllPaged<Record<string, unknown>>((from, to) =>
    admin
      .from('pos_sales')
      .select('id, total, payment_status, created_at')
      .eq('business_id', businessId)
      .gte('created_at', rangeStart)
      .lte('created_at', rangeEnd)
      .range(from, to),
  )

  const refunds = await fetchAllPaged<Record<string, unknown>>((from, to) =>
    admin
      .from('pos_refunds')
      .select('total_refund_amount, refund_method, created_at')
      .eq('business_id', businessId)
      .gte('created_at', rangeStart)
      .lte('created_at', rangeEnd)
      .range(from, to),
  )

  const payments = await fetchAllPaged<Record<string, unknown>>((from, to) =>
    admin
      .from('pos_payments')
      .select('amount, payment_method, notes, created_at')
      .eq('business_id', businessId)
      .gte('created_at', rangeStart)
      .lte('created_at', rangeEnd)
      .range(from, to),
  )

  const anetRows = await fetchAllPaged<Record<string, unknown>>((from, to) =>
    admin
      .from('authorize_net_transactions')
      .select('amount, status, transaction_kind, event_date, created_at')
      .eq('business_id', businessId)
      .gte('event_date', rangeStart)
      .lte('event_date', rangeEnd)
      .order('event_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )

  const [cloverRows, excelChannelRows] = await Promise.all([
    fetchAllPaged<Record<string, unknown>>((from, to) =>
      admin
        .from('clover_transactions')
        .select('amount, status, transaction_kind, event_date, created_at, result, raw_details')
        .eq('business_id', businessId)
        .gte('event_date', rangeStart)
        .lte('event_date', rangeEnd)
        .order('event_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
    fetchAllPaged<Record<string, unknown>>((from, to) =>
      admin
        .from('daily_sales_excel_channels')
        .select('sales_date, clover, authorize_net')
        .eq('business_id', businessId)
        .gte('sales_date', startDateKey)
        .lte('sales_date', endDateKey)
        .order('sales_date', { ascending: true })
        .range(from, to)),
  ])

  const excelChannelMap: Record<string, { clover: number | null; authorizeNet: number | null }> = {}
  for (const row of excelChannelRows) {
    const key = String(row.sales_date).slice(0, 10)
    excelChannelMap[key] = {
      clover: row.clover == null ? null : Number(row.clover),
      authorizeNet: row.authorize_net == null ? null : Number(row.authorize_net),
    }
  }

  let cloverTenderMap: Record<string, { label: string; labelKey: string }> = {}
  const cloverCreds = await getCloverCredentialsForBusiness(admin, businessId)
  if (cloverCreds) {
    try {
      cloverTenderMap = await fetchCloverTenders(cloverCreds)
    } catch (e) {
      console.warn('[dailySalesLedger] clover tenders fetch failed', e)
    }
  }

  const completed = sales.filter(
    (s) => s.payment_status === 'paid' || s.payment_status === 'completed',
  )

  for (const sale of completed) {
    const key = businessDayKeyForIso(String(sale.created_at), tz, salesDayEndTime)
    if (!includeDay(key)) continue
    ensureDay(key)
    byDay[key].posGross += Number(sale.total) || 0
  }

  for (const refund of refunds || []) {
    const key = businessDayKeyForIso(String(refund.created_at), tz, salesDayEndTime)
    if (!includeDay(key)) continue
    ensureDay(key)
    const amount = Number(refund.total_refund_amount) || 0
    byDay[key].posRefunds += amount
    const tender = posRefundTenderCategory(refund.refund_method as string | null)
    if (tender === 'cash') byDay[key].helcimCash -= amount
  }

  for (const payment of payments || []) {
    const key = businessDayKeyForIso(String(payment.created_at), tz, salesDayEndTime)
    if (!includeDay(key)) continue
    ensureDay(key)
    const tender = posPaymentTenderCategory(
      String(payment.payment_method || ''),
      typeof payment.notes === 'string' ? payment.notes : null,
    )
    if (tender === 'cash') byDay[key].helcimCash += Number(payment.amount) || 0
  }

  for (const row of anetRows || []) {
    const ts = row.event_date || row.created_at
    if (!ts) continue
    const key = businessDayKeyForIso(String(ts), tz, salesDayEndTime)
    if (!includeDay(key)) continue
    ensureDay(key)
    byDay[key].authorizeNet += authorizeNetSignedAmount(row)
  }

  for (const row of cloverRows || []) {
    const ts = row.event_date || row.created_at
    if (!ts) continue
    const key = businessDayKeyForIso(String(ts), tz, salesDayEndTime)
    if (!includeDay(key)) continue
    ensureDay(key)
    const signed = cloverSignedAmount(row)
    if (!signed) continue
    byDay[key].clover += signed

    const raw = row.raw_details as Record<string, unknown> | null
    const tenderKey = cloverTenderKeyFromRaw(raw, cloverTenderMap)
    if (tenderKey === 'cash') byDay[key].cloverCash += signed
  }

  const outputDays = fillCalendarDays ? calendarDays : Object.keys(byDay).sort()
  return outputDays.map((date) => {
    const row = byDay[date] || { posGross: 0, posRefunds: 0, helcimCash: 0, authorizeNet: 0, clover: 0, cloverCash: 0 }
    const apiHelcim = Math.round((row.posGross - row.posRefunds) * 100) / 100
    const helcimCashInSystem = Math.round(row.helcimCash * 100) / 100
    const apiClover = Math.round(row.clover * 100) / 100
    const cloverCashInSystem = Math.round(row.cloverCash * 100) / 100
    const apiAuthorize = Math.round(row.authorizeNet * 100) / 100
    const excel = excelChannelMap[date]
    const resolved = resolveChannelSalesForDay({
      apiClover,
      apiHelcim,
      apiAuthorize,
      excelClover: excel?.clover ?? null,
      excelAuthorize: excel?.authorizeNet ?? null,
    })
    return {
      date,
      label: dayjs.tz(`${date}T12:00:00`, tz).format('ddd'),
      clover: resolved.clover,
      helcim: resolved.helcim,
      authorizeNet: resolved.authorizeNet,
      helcimCashInSystem,
      cloverCashInSystem,
      salesFromExcel: resolved.salesFromExcel,
    }
  })
}

export function defaultRankingsFromDate(endDateKey: string, tz: string): string {
  return dayjs.tz(`${endDateKey}T12:00:00`, tz).startOf('year').format('YYYY-MM-DD')
}

export function defaultSummaryFromDate(endDateKey: string, tz: string): string {
  return dayjs.tz(`${endDateKey}T12:00:00`, tz).subtract(1, 'year').startOf('year').format('YYYY-MM-DD')
}

function rowsFromCore(
  coreRows: Awaited<ReturnType<typeof loadDailySalesCore>>,
  manualCashMap: Record<string, number | null>,
  laborByDate: Record<string, number>,
): DailySalesRow[] {
  return coreRows.map((core) => {
    const manualCash = Object.prototype.hasOwnProperty.call(manualCashMap, core.date)
      ? manualCashMap[core.date]
      : null
    const cashStatus = manualCash == null ? 'not_entered' : 'entered'
    const totalSales = resolveTotalSales(
      core.clover,
      core.helcim,
      core.authorizeNet,
      manualCash,
    )
    const laborDollars = laborByDate[core.date] ?? 0
    const laborPercent = computeLaborPercent(
      laborDollars,
      totalSales,
      core.clover,
      core.helcim,
      core.authorizeNet,
    )
    const profitAfterWages = totalSales != null
      ? Math.round((totalSales - laborDollars) * 100) / 100
      : null

    return {
      date: core.date,
      label: core.label,
      clover: core.clover,
      helcim: core.helcim,
      authorizeNet: core.authorizeNet,
      helcimCashInSystem: core.helcimCashInSystem,
      cloverCashInSystem: core.cloverCashInSystem,
      manualCash,
      cashStatus,
      totalSales,
      laborDollars,
      laborPercent,
      profitAfterWages,
      rankOverall: null,
      rankThisYear: null,
      rankProfitOverall: null,
      rankThisMonth: null,
      salesFromExcel: core.salesFromExcel,
    }
  })
}

export async function loadLaborForDateRange(
  admin: SupabaseClient,
  businessId: string,
  tz: string,
  startDateKey: string,
  endDateKey: string,
): Promise<number> {
  const byDate = await loadLaborByDateForRange(admin, businessId, tz, startDateKey, endDateKey)
  return Object.values(byDate).reduce((sum, n) => sum + n, 0)
}

export async function loadLaborByDateForRange(
  admin: SupabaseClient,
  businessId: string,
  tz: string,
  startDateKey: string,
  endDateKey: string,
): Promise<Record<string, number>> {
  const { laborByDate } = await loadLaborAndSubsidyByDateForRange(
    admin,
    businessId,
    tz,
    startDateKey,
    endDateKey,
  )
  return laborByDate
}

export async function loadLaborAndSubsidyByDateForRange(
  admin: SupabaseClient,
  businessId: string,
  tz: string,
  startDateKey: string,
  endDateKey: string,
): Promise<{ laborByDate: Record<string, number>; subsidyByDate: Record<string, number> }> {
  const days = dateKeysBetween(startDateKey, endDateKey, tz)
  const laborByDate: Record<string, number> = {}
  const subsidyByDate: Record<string, number> = {}
  for (const day of days) {
    laborByDate[day] = 0
    subsidyByDate[day] = 0
  }
  if (days.length === 0) return { laborByDate, subsidyByDate }

  const clockQueryStart = weekStartSundayKey(startDateKey, tz)
  const startIso = dayjs.tz(`${clockQueryStart}T00:00:00`, tz).toISOString()
  const endIso = dayjs.tz(`${endDateKey}T23:59:59.999`, tz).toISOString()
  const nowIso = new Date().toISOString()

  const { data: clocks, error: clocksErr } = await admin
    .from('scheduling_time_clocks')
    .select(`
      id, employee_id, clock_in_time, clock_out_time, break_duration_minutes,
      users!scheduling_time_clocks_employee_id_fkey (
        id, wage,
        labor_subsidy_enabled, labor_subsidy_partner, labor_subsidy_wage_cap,
        labor_subsidy_max_hours_per_week, labor_subsidy_start_date, labor_subsidy_end_date
      )
    `)
    .eq('business_id', businessId)
    .gte('clock_in_time', startIso)
    .lte('clock_in_time', endIso)
    .not('employee_id', 'is', null)

  if (clocksErr) throw clocksErr

  const employeeIds = [...new Set((clocks || []).map((c) => String(c.employee_id)).filter(Boolean))]
  const premiumsByEmployee: Record<string, Array<Record<string, unknown>>> = {}
  const subsidyByEmployee: Record<string, NonNullable<ReturnType<typeof parseSubsidyConfig>>> = {}

  if (employeeIds.length) {
    const { data: premiumRows } = await admin
      .from('hrpayroll_employee_premiums')
      .select('user_id, premium_name, premium_rate, applies_to_all_hours, is_active, approval_status')
      .eq('business_id', businessId)
      .in('user_id', employeeIds)
      .eq('is_active', true)
      .or('approval_status.is.null,approval_status.eq.approved')

    for (const row of premiumRows || []) {
      const uid = String(row.user_id)
      if (!premiumsByEmployee[uid]) premiumsByEmployee[uid] = []
      premiumsByEmployee[uid].push(row as Record<string, unknown>)
    }
  }

  const clockIds = (clocks || []).map((c) => c.id)
  const breaksByClock: Record<string, Array<Record<string, unknown>>> = {}
  if (clockIds.length) {
    const { data: breaks } = await admin
      .from('scheduling_break_tracking')
      .select('*')
      .in('time_clock_id', clockIds)

    for (const b of breaks || []) {
      const id = String(b.time_clock_id)
      if (!breaksByClock[id]) breaksByClock[id] = []
      breaksByClock[id].push(b as Record<string, unknown>)
    }
  }

  const clockLaborRows: ClockLaborRow[] = []
  const punchWeekKeysByEmployee = new Set<string>()
  const employeeWages: Record<string, number> = {}

  for (const clock of clocks || []) {
    const clockIn = String(clock.clock_in_time)
    const dayKey = dayjs(clockIn).tz(tz).format('YYYY-MM-DD')
    const empId = String(clock.employee_id)
    const clockOut = clock.clock_out_time ? String(clock.clock_out_time) : nowIso

    const breakRows = breaksByClock[String(clock.id)] || []
    let unpaid = 0
    for (const b of breakRows) {
      if (b.is_paid || b.break_type === 'paid') continue
      let dm = b.duration_minutes as number | string | null
      if ((dm == null || dm === '') && b.break_start_at && b.break_end_at) {
        const derived = dayjs(String(b.break_end_at)).diff(dayjs(String(b.break_start_at)), 'minute')
        dm = derived > 0 ? derived : 0
      }
      if (dm != null && dm !== '' && !Number.isNaN(parseFloat(String(dm)))) {
        unpaid += parseFloat(String(dm))
      }
    }
    if (!breakRows.length) unpaid = Number(clock.break_duration_minutes) || 0

    const grossMin = dayjs(clockOut).diff(dayjs(clockIn), 'minute')
    const paidMin = Math.max(0, grossMin - unpaid)
    if (paidMin > 0) {
      punchWeekKeysByEmployee.add(`${empId}|${weekStartSundayKey(dayKey, tz)}`)
    }

    const user = clock.users as Record<string, unknown> | null
    const baseWage = Number(user?.wage) || 0
    const assignments = premiumsByEmployee[empId] || []
    const premiumPerHour = premiumPerHourFromAssignments(baseWage, assignments)
    const parsedSubsidy = parseSubsidyConfig(user)
    if (parsedSubsidy) subsidyByEmployee[empId] = parsedSubsidy
    employeeWages[empId] = Number(user?.wage) || employeeWages[empId] || 0

    clockLaborRows.push({
      employeeId: empId,
      clockInIso: clockIn,
      paidMinutes: paidMin,
      baseWage,
      premiumPerHour,
      dayKey,
    })
  }

  const accumulated = accumulateLaborAndSubsidyByDate({
    clocks: clockLaborRows,
    subsidyByEmployee,
    tz,
  })

  for (const day of days) {
    laborByDate[day] = accumulated.laborByDate[day] ?? 0
    subsidyByDate[day] = accumulated.subsidyByDate[day] ?? 0
  }

  const { data: businessUsers, error: buErr } = await admin
    .from('business_users')
    .select(`
      user_id,
      users!business_users_user_id_fkey (
        id, wage,
        labor_subsidy_enabled, labor_subsidy_partner, labor_subsidy_wage_cap,
        labor_subsidy_max_hours_per_week, labor_subsidy_start_date, labor_subsidy_end_date
      )
    `)
    .eq('business_id', businessId)

  if (buErr) {
    console.warn('[loadLaborAndSubsidyByDateForRange] business_users query failed', buErr.message)
  } else {
    for (const row of businessUsers || []) {
      const user = row.users as Record<string, unknown> | null
      if (!user?.id) continue
      const empId = String(user.id)
      const parsed = parseSubsidyConfig(user)
      if (parsed) {
        subsidyByEmployee[empId] = parsed
        employeeWages[empId] = Number(user.wage) || employeeWages[empId] || 0
      }
    }
  }

  const shiftQueryStart = clockQueryStart
  const { data: shiftRows, error: shiftsErr } = await admin
    .from('scheduling_shifts')
    .select(`
      employee_id, shift_date, start_time, end_time, break_duration_minutes, status,
      users!scheduling_shifts_employee_id_fkey ( id, wage )
    `)
    .eq('business_id', businessId)
    .gte('shift_date', shiftQueryStart)
    .lte('shift_date', endDateKey)
    .not('employee_id', 'is', null)

  if (shiftsErr) throw shiftsErr

  const timesheetShifts: TimesheetShiftRow[] = []
  const shiftHoursByEmployeeWeek: Record<string, number> = {}
  for (const shift of shiftRows || []) {
    const empId = String(shift.employee_id)
    if (!subsidyByEmployee[empId]) continue
    const user = shift.users as Record<string, unknown> | null
    if (user?.wage != null) {
      employeeWages[empId] = Number(user.wage) || employeeWages[empId] || 0
    }
    const row: TimesheetShiftRow = {
      employeeId: empId,
      shiftDate: String(shift.shift_date).slice(0, 10),
      startTime: String(shift.start_time || ''),
      endTime: String(shift.end_time || ''),
      breakMinutes: Number(shift.break_duration_minutes) || 0,
      status: String(shift.status || 'scheduled'),
      baseWage: employeeWages[empId] || Number(user?.wage) || 0,
    }
    timesheetShifts.push(row)
    const weekKey = `${empId}|${weekStartSundayKey(row.shiftDate, tz)}`
    shiftHoursByEmployeeWeek[weekKey] = (shiftHoursByEmployeeWeek[weekKey] || 0) + shiftPaidHours(row, tz)
  }

  applyTimesheetSpreadSubsidy({
    shifts: timesheetShifts,
    subsidyByEmployee,
    employeeWages,
    punchWeekKeysByEmployee,
    subsidyByDate,
    tz,
    outputStartKey: startDateKey,
    outputEndKey: endDateKey,
  })

  const { data: approvalRows, error: approvalsErr } = await admin
    .from('scheduling_timesheet_approvals')
    .select(`
      period_start,
      period_end,
      scheduling_timesheet_approval_lines (
        user_id,
        total_hours
      )
    `)
    .eq('business_id', businessId)
    .eq('status', 'approved')
    .lte('period_start', endDateKey)
    .gte('period_end', clockQueryStart)

  if (approvalsErr) {
    console.warn('[loadLaborAndSubsidyByDateForRange] timesheet approvals query failed', approvalsErr.message)
  } else {
    const approvalLines: PeriodHoursLineRow[] = []
    for (const approval of approvalRows || []) {
      const periodStart = String(approval.period_start).slice(0, 10)
      const periodEnd = String(approval.period_end).slice(0, 10)
      for (const line of (approval.scheduling_timesheet_approval_lines as Array<Record<string, unknown>>) || []) {
        const employeeId = String(line.user_id || '')
        if (!employeeId || !subsidyByEmployee[employeeId]) continue
        approvalLines.push({
          employeeId,
          periodStart,
          periodEnd,
          totalHours: Number(line.total_hours) || 0,
        })
      }
    }
    applyPeriodHoursSpreadSubsidy({
      lines: approvalLines,
      subsidyByEmployee,
      employeeWages,
      punchWeekKeysByEmployee,
      existingHoursByEmployeeWeek: shiftHoursByEmployeeWeek,
      subsidyByDate,
      tz,
      outputStartKey: startDateKey,
      outputEndKey: endDateKey,
    })
  }

  const { data: payrollRows, error: payrollErr } = await admin
    .from('hrpayroll_entries')
    .select(`
      user_id,
      total_hours,
      hrpayroll_runs!hrpayroll_entries_payroll_run_id_fkey!inner (
        business_id,
        pay_period_start,
        pay_period_end,
        status
      )
    `)
    .eq('hrpayroll_runs.business_id', businessId)
    .gt('total_hours', 0)
    .lte('hrpayroll_runs.pay_period_start', endDateKey)
    .gte('hrpayroll_runs.pay_period_end', clockQueryStart)
    .in('hrpayroll_runs.status', ['finalized', 'edited'])

  if (payrollErr) {
    console.warn('[loadLaborAndSubsidyByDateForRange] payroll entries query failed', payrollErr.message)
  } else {
    const payrollByEmployeePeriod: Record<
      string,
      { line: PeriodHoursLineRow; rank: number }
    > = {}
    for (const entry of payrollRows || []) {
      const employeeId = String(entry.user_id || '')
      if (!employeeId || !subsidyByEmployee[employeeId]) continue
      const run = entry.hrpayroll_runs as Record<string, unknown> | null
      if (!run) continue
      const periodStart = String(run.pay_period_start || '').slice(0, 10)
      const periodEnd = String(run.pay_period_end || '').slice(0, 10)
      if (!periodStart || !periodEnd) continue
      const status = String(run.status || '')
      if (status !== 'finalized' && status !== 'edited') continue
      const totalHours = Number(entry.total_hours) || 0
      if (totalHours <= 0) continue
      const dedupeKey = `${employeeId}|${periodStart}|${periodEnd}`
      const rank = status === 'finalized' ? 2 : 1
      const existing = payrollByEmployeePeriod[dedupeKey]
      if (
        !existing
        || rank > existing.rank
        || (rank === existing.rank && totalHours > existing.line.totalHours)
      ) {
        payrollByEmployeePeriod[dedupeKey] = {
          rank,
          line: { employeeId, periodStart, periodEnd, totalHours },
        }
      }
    }
    applyPeriodHoursSpreadSubsidy({
      lines: Object.values(payrollByEmployeePeriod).map((row) => row.line),
      subsidyByEmployee,
      employeeWages,
      punchWeekKeysByEmployee,
      existingHoursByEmployeeWeek: shiftHoursByEmployeeWeek,
      subsidyByDate,
      tz,
      outputStartKey: startDateKey,
      outputEndKey: endDateKey,
    })
  }

  for (const day of days) {
    subsidyByDate[day] = Math.round((subsidyByDate[day] || 0) * 100) / 100
  }

  return { laborByDate, subsidyByDate }
}

function denseRankByDate(
  rows: Array<{ date: string; value: number }>,
): Record<string, number> {
  const sorted = [...rows].sort((a, b) => b.value - a.value)
  const rankByDate: Record<string, number> = {}
  let rank = 0
  let prev: number | null = null
  for (let i = 0; i < sorted.length; i++) {
    if (prev === null || sorted[i].value !== prev) rank = i + 1
    rankByDate[sorted[i].date] = rank
    prev = sorted[i].value
  }
  return rankByDate
}

export function attachRankings(rows: DailySalesRow[]): DailySalesRow[] {
  const complete = rows.filter((r) => r.cashStatus === 'entered' && r.totalSales != null)

  const overallRank = denseRankByDate(
    complete.map((r) => ({ date: r.date, value: r.totalSales as number })),
  )
  const profitRank = denseRankByDate(
    complete
      .filter((r) => r.profitAfterWages != null)
      .map((r) => ({ date: r.date, value: r.profitAfterWages as number })),
  )

  const yearRankMaps: Record<string, Record<string, number>> = {}
  const monthRankMaps: Record<string, Record<string, number>> = {}

  const years = [...new Set(complete.map((r) => r.date.slice(0, 4)))]
  for (const year of years) {
    yearRankMaps[year] = denseRankByDate(
      complete
        .filter((r) => r.date.startsWith(`${year}-`))
        .map((r) => ({ date: r.date, value: r.totalSales as number })),
    )
  }

  const monthKeys = [...new Set(complete.map((r) => r.date.slice(0, 7)))]
  for (const monthKey of monthKeys) {
    monthRankMaps[monthKey] = denseRankByDate(
      complete
        .filter((r) => r.date.startsWith(`${monthKey}-`))
        .map((r) => ({ date: r.date, value: r.totalSales as number })),
    )
  }

  return rows.map((row) => {
    const year = row.date.slice(0, 4)
    const monthKey = row.date.slice(0, 7)
    const isComplete = row.cashStatus === 'entered' && row.totalSales != null
    return {
      ...row,
      rankOverall: isComplete ? overallRank[row.date] ?? null : null,
      rankThisYear: isComplete ? yearRankMaps[year]?.[row.date] ?? null : null,
      rankProfitOverall: isComplete && row.profitAfterWages != null
        ? profitRank[row.date] ?? null
        : null,
      rankThisMonth: isComplete ? monthRankMaps[monthKey]?.[row.date] ?? null : null,
    }
  })
}

export async function buildLedgerRows(
  admin: SupabaseClient,
  businessId: string,
  tz: string,
  salesDayEndTime: string,
  startDateKey: string,
  endDateKey: string,
  rankingsStartDateKey: string,
): Promise<DailySalesRow[]> {
  const payload = await buildLedgerPayload(
    admin,
    businessId,
    tz,
    salesDayEndTime,
    startDateKey,
    endDateKey,
    rankingsStartDateKey,
  )
  return payload.rows
}

export async function buildLedgerPayload(
  admin: SupabaseClient,
  businessId: string,
  tz: string,
  salesDayEndTime: string,
  startDateKey: string,
  endDateKey: string,
  _rankingsStartDateKey?: string,
): Promise<{
  rows: DailySalesRow[]
  monthlySummary: MonthlySummaryCell[]
  ytdSummary: YtdSummaryRow[]
  rankingsFrom: string
  summaryFrom: string
}> {
  // Keep the request bounded to the visible date range only so the edge function stays within CPU/memory limits.
  const [coreRows, manualCashMap, laborByDate] = await Promise.all([
    loadDailySalesCore(admin, businessId, tz, startDateKey, endDateKey, salesDayEndTime, {
      fillCalendarDays: true,
    }),
    loadManualCashMap(admin, businessId, startDateKey, endDateKey),
    loadLaborByDateForRange(admin, businessId, tz, startDateKey, endDateKey),
  ])

  const rankedRows = attachRankings(rowsFromCore(coreRows, manualCashMap, laborByDate))

  return {
    rows: rankedRows,
    monthlySummary: buildMonthlySummary(rankedRows, endDateKey),
    ytdSummary: buildYtdSummary(rankedRows, endDateKey),
    rankingsFrom: startDateKey,
    summaryFrom: startDateKey,
  }
}

export function buildMonthlySummary(rows: DailySalesRow[], anchorDateKey: string | null = null): MonthlySummaryCell[] {
  const scopedRows = anchorDateKey
    ? rows.filter((row) => {
        const year = parseInt(row.date.slice(0, 4), 10)
        return row.date <= ytdEndKeyForYear(year, anchorDateKey)
      })
    : rows
  const byKey: Record<string, MonthlySummaryCell> = {}

  for (const row of scopedRows) {
    const year = parseInt(row.date.slice(0, 4), 10)
    const month = parseInt(row.date.slice(5, 7), 10)
    const key = `${year}-${String(month).padStart(2, '0')}`
    if (!byKey[key]) {
      byKey[key] = {
        year,
        month,
        monthLabel: dayjs(`${key}-01`).format('MMM'),
        sales: 0,
        laborDollars: 0,
        laborPercent: null,
        dayCount: 0,
        completeDayCount: 0,
      }
    }
    byKey[key].dayCount += 1
    byKey[key].laborDollars += row.laborDollars
    if (row.totalSales != null) {
      byKey[key].sales += row.totalSales
      byKey[key].completeDayCount += 1
    }
  }

  return Object.values(byKey)
    .map((cell) => ({
      ...cell,
      sales: Math.round(cell.sales * 100) / 100,
      laborDollars: Math.round(cell.laborDollars * 100) / 100,
      laborPercent: cell.sales > 0
        ? Math.round((cell.laborDollars / cell.sales) * 1000) / 10
        : null,
    }))
    .sort((a, b) => (a.year - b.year) || (a.month - b.month))
}

export function buildYtdSummary(rows: DailySalesRow[], anchorDateKey: string, priorYears = 3): YtdSummaryRow[] {
  const anchorYear = parseInt(anchorDateKey.slice(0, 4), 10)
  const years: number[] = []
  for (let offset = 0; offset <= priorYears; offset += 1) {
    years.push(anchorYear - offset)
  }

  return years.map((year) => {
    const ytdEndKey = ytdEndKeyForYear(year, anchorDateKey)
    const eligible = rows.filter(
      (row) => row.date.startsWith(`${year}-`) && row.date <= ytdEndKey,
    )

    let salesYtd = 0
    let laborDollarsYtd = 0
    let completeDayCount = 0
    for (const row of eligible) {
      laborDollarsYtd += row.laborDollars
      if (row.totalSales != null) {
        salesYtd += row.totalSales
        completeDayCount += 1
      }
    }

    const profitAfterWagesYtd = completeDayCount > 0
      ? Math.round((salesYtd - laborDollarsYtd) * 100) / 100
      : null

    return {
      year,
      ytdThrough: ytdEndKey,
      salesYtd: Math.round(salesYtd * 100) / 100,
      laborDollarsYtd: Math.round(laborDollarsYtd * 100) / 100,
      laborPercent: salesYtd > 0
        ? Math.round((laborDollarsYtd / salesYtd) * 1000) / 10
        : null,
      profitAfterWagesYtd,
      completeDayCount,
    }
  })
}

export function ytdEndKeyForYear(year: number, anchorDateKey: string): string {
  const anchorYear = parseInt(anchorDateKey.slice(0, 4), 10)
  if (year === anchorYear) return anchorDateKey
  const month = parseInt(anchorDateKey.slice(5, 7), 10)
  const day = parseInt(anchorDateKey.slice(8, 10), 10)
  const lastDay = new Date(year, month, 0).getDate()
  const clampedDay = Math.min(day, lastDay)
  return `${year}-${String(month).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`
}

export type ExternalDaySyncResult = {
  date: string
  cloverScanned: number
  cloverImported: number
  cloverUpdated: number
  cloverFailed: number
  anetScanned: number
  anetImported: number
  anetUpdated: number
  anetFailed: number
  cloverError: string | null
  anetError: string | null
}

export type ExternalSyncStats = {
  cloverConfigured: boolean
  anetConfigured: boolean
  cloverScanned: number
  cloverImported: number
  cloverUpdated: number
  cloverFailed: number
  anetScanned: number
  anetImported: number
  anetUpdated: number
  anetFailed: number
  errors: string[]
}

export type BackfillBatchResult = ExternalSyncStats & {
  ok: boolean
  error?: string
  startDate: string
  endDate: string
  cursorDate: string
  nextCursor: string | null
  hasMore: boolean
  syncedDays: number
  processedThrough: string | null
}

export async function getExternalSalesSyncStatus(
  admin: SupabaseClient,
  businessId: string,
  tz: string,
) {
  const [cloverCreds, anetCreds] = await Promise.all([
    getCloverCredentialsForBusiness(admin, businessId),
    getAuthorizeNetCredentialsForBusiness(admin, businessId),
  ])

  const { data: cloverRange } = await admin
    .from('clover_transactions')
    .select('event_date')
    .eq('business_id', businessId)
    .order('event_date', { ascending: true })
    .limit(1)

  const { data: cloverRangeMax } = await admin
    .from('clover_transactions')
    .select('event_date')
    .eq('business_id', businessId)
    .order('event_date', { ascending: false })
    .limit(1)

  const { count: cloverCount } = await admin
    .from('clover_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)

  const { data: anetRange } = await admin
    .from('authorize_net_transactions')
    .select('event_date')
    .eq('business_id', businessId)
    .order('event_date', { ascending: true })
    .limit(1)

  const { data: anetRangeMax } = await admin
    .from('authorize_net_transactions')
    .select('event_date')
    .eq('business_id', businessId)
    .order('event_date', { ascending: false })
    .limit(1)

  const { count: anetCount } = await admin
    .from('authorize_net_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)

  const toDateKey = (iso: string | null | undefined) => {
    if (!iso) return null
    return businessDayKeyForIso(String(iso), tz, '23:59')
  }

  return {
    cloverConfigured: !!cloverCreds,
    anetConfigured: !!anetCreds,
    cloverStoredCount: cloverCount ?? 0,
    anetStoredCount: anetCount ?? 0,
    cloverStoredFrom: toDateKey(cloverRange?.[0]?.event_date as string | undefined),
    cloverStoredTo: toDateKey(cloverRangeMax?.[0]?.event_date as string | undefined),
    anetStoredFrom: toDateKey(anetRange?.[0]?.event_date as string | undefined),
    anetStoredTo: toDateKey(anetRangeMax?.[0]?.event_date as string | undefined),
  }
}

export async function refreshExternalSalesForDate(
  admin: SupabaseClient,
  businessId: string,
  dateKey: string,
  tz: string,
): Promise<ExternalDaySyncResult> {
  const result: ExternalDaySyncResult = {
    date: dateKey,
    cloverScanned: 0,
    cloverImported: 0,
    cloverUpdated: 0,
    cloverFailed: 0,
    anetScanned: 0,
    anetImported: 0,
    anetUpdated: 0,
    anetFailed: 0,
    cloverError: null,
    anetError: null,
  }

  const cloverCreds = await getCloverCredentialsForBusiness(admin, businessId)
  if (cloverCreds) {
    try {
      const payments = await collectPaymentsForSyncDate(cloverCreds, dateKey, tz)
      result.cloverScanned = payments.length
      for (const details of payments) {
        const upsert = await upsertCloverTransactionRow(admin, {
          businessId,
          details,
          paymentSource: cloverCreds.paymentSource,
          eventDate: details.createdTime ?? details.modifiedTime,
        })
        if (!upsert.ok) {
          result.cloverFailed += 1
          continue
        }
        if (upsert.created) result.cloverImported += 1
        else result.cloverUpdated += 1
      }
    } catch (e) {
      result.cloverError = e instanceof Error ? e.message : String(e)
      console.warn('[dailySalesLedger] clover sync failed', dateKey, e)
    }
  }

  const anetCreds = await getAuthorizeNetCredentialsForBusiness(admin, businessId)
  if (anetCreds) {
    try {
      const summaries = await collectTransactionsForSyncDate(anetCreds, dateKey)
      result.anetScanned = summaries.length
      for (const summary of summaries) {
        const details = await fetchAuthorizeNetTransactionDetails(anetCreds, summary.transId)
        if (!details) {
          result.anetFailed += 1
          continue
        }
        const upsert = await upsertAuthorizeNetTransactionRow(admin, {
          businessId,
          details,
          paymentSource: anetCreds.paymentSource,
          eventDate: details.submitTimeUTC ?? details.submitTimeLocal ?? summary.submitTimeUTC ?? summary.submitTimeLocal,
          summaryStatus: summary.transactionStatus,
        })
        if (!upsert.ok) {
          result.anetFailed += 1
          continue
        }
        if (upsert.created) result.anetImported += 1
        else result.anetUpdated += 1
      }
    } catch (e) {
      result.anetError = e instanceof Error ? e.message : String(e)
      console.warn('[dailySalesLedger] authorize.net sync failed', dateKey, e)
    }
  }

  return result
}

function emptySyncStats(): ExternalSyncStats {
  return {
    cloverConfigured: false,
    anetConfigured: false,
    cloverScanned: 0,
    cloverImported: 0,
    cloverUpdated: 0,
    cloverFailed: 0,
    anetScanned: 0,
    anetImported: 0,
    anetUpdated: 0,
    anetFailed: 0,
    errors: [],
  }
}

function mergeDaySyncStats(target: ExternalSyncStats, day: ExternalDaySyncResult) {
  target.cloverScanned += day.cloverScanned
  target.cloverImported += day.cloverImported
  target.cloverUpdated += day.cloverUpdated
  target.cloverFailed += day.cloverFailed
  target.anetScanned += day.anetScanned
  target.anetImported += day.anetImported
  target.anetUpdated += day.anetUpdated
  target.anetFailed += day.anetFailed
  if (day.cloverError) target.errors.push(`${day.date} Clover: ${day.cloverError}`)
  if (day.anetError) target.errors.push(`${day.date} Authorize.net: ${day.anetError}`)
}

export async function backfillExternalSales(
  admin: SupabaseClient,
  businessId: string,
  tz: string,
  startDateKey: string,
  endDateKey: string,
  options: { cursorDate?: string; maxDays?: number } = {},
): Promise<BackfillBatchResult> {
  const maxDays = Math.max(1, Math.min(options.maxDays ?? 1, 7))
  const cursorDate = options.cursorDate && options.cursorDate >= startDateKey
    ? options.cursorDate
    : startDateKey

  const [cloverCreds, anetCreds] = await Promise.all([
    getCloverCredentialsForBusiness(admin, businessId),
    getAuthorizeNetCredentialsForBusiness(admin, businessId),
  ])

  const stats = emptySyncStats()
  stats.cloverConfigured = !!cloverCreds
  stats.anetConfigured = !!anetCreds

  if (!stats.cloverConfigured && !stats.anetConfigured) {
    return {
      ok: false,
      error: 'No Clover or Authorize.net credentials are configured for this business. Connect them under Settings before running backfill.',
      startDate: startDateKey,
      endDate: endDateKey,
      cursorDate,
      nextCursor: cursorDate,
      hasMore: cursorDate <= endDateKey,
      syncedDays: 0,
      processedThrough: null,
      ...stats,
    }
  }

  const days = dateKeysBetween(cursorDate, endDateKey, tz).slice(0, maxDays)
  if (days.length === 0) {
    return {
      ok: true,
      startDate: startDateKey,
      endDate: endDateKey,
      cursorDate,
      nextCursor: null,
      hasMore: false,
      syncedDays: 0,
      processedThrough: null,
      ...stats,
    }
  }

  for (const dateKey of days) {
    const dayStats = await refreshExternalSalesForDate(admin, businessId, dateKey, tz)
    mergeDaySyncStats(stats, dayStats)
  }

  const processedThrough = days[days.length - 1]
  const hasMore = processedThrough < endDateKey
  const nextCursor = hasMore
    ? dayjs.tz(`${processedThrough}T12:00:00`, tz).add(1, 'day').format('YYYY-MM-DD')
    : null

  return {
    ok: true,
    startDate: startDateKey,
    endDate: endDateKey,
    cursorDate,
    nextCursor,
    hasMore,
    syncedDays: days.length,
    processedThrough,
    ...stats,
  }
}

export async function loadManualLaborMap(
  admin: SupabaseClient,
  businessId: string,
  startDateKey: string,
  endDateKey: string,
): Promise<Record<string, number | null>> {
  const { data, error } = await admin
    .from('daily_sales_manual_labor')
    .select('sales_date, labor_dollars')
    .eq('business_id', businessId)
    .gte('sales_date', startDateKey)
    .lte('sales_date', endDateKey)

  if (error) throw error

  const map: Record<string, number | null> = {}
  for (const row of data || []) {
    const key = String(row.sales_date).slice(0, 10)
    map[key] = row.labor_dollars == null ? null : Number(row.labor_dollars)
  }
  return map
}

export function resolveLaborDollars(
  clockLabor: number,
  manualLabor: number | null | undefined,
): number {
  if (manualLabor != null) return Math.round(Number(manualLabor) * 100) / 100
  return Math.round(Number(clockLabor || 0) * 100) / 100
}

export async function saveManualCashEntry(
  admin: SupabaseClient,
  businessId: string,
  salesDate: string,
  cashCollected: number | null,
  enteredBy: string,
  notes?: string | null,
) {
  if (cashCollected == null) {
    const { error } = await admin
      .from('daily_sales_manual_cash')
      .delete()
      .eq('business_id', businessId)
      .eq('sales_date', salesDate)
    if (error) throw error
    return { cashStatus: 'not_entered' as const, manualCash: null }
  }

  const { error } = await admin
    .from('daily_sales_manual_cash')
    .upsert(
      {
        business_id: businessId,
        sales_date: salesDate,
        cash_collected: cashCollected,
        notes: notes ?? null,
        entered_by: enteredBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'business_id,sales_date' },
    )

  if (error) throw error
  return { cashStatus: 'entered' as const, manualCash: cashCollected }
}

function rowHasLedgerData(row: DailySalesRow): boolean {
  return (
    row.totalSales != null
    || row.clover !== 0
    || row.helcim !== 0
    || row.authorizeNet !== 0
    || row.manualCash != null
    || row.manualLabor != null
    || row.laborDollars > 0
  )
}

function rowToLedgerSnapshotPayload(businessId: string, row: DailySalesRow) {
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
  }
}

export async function upsertLedgerDaySnapshot(
  admin: SupabaseClient,
  businessId: string,
  row: DailySalesRow,
) {
  if (!rowHasLedgerData(row)) {
    const { error } = await admin
      .from('daily_sales_ledger_days')
      .delete()
      .eq('business_id', businessId)
      .eq('sales_date', row.date)
    if (error) throw error
    return
  }

  const { error } = await admin
    .from('daily_sales_ledger_days')
    .upsert(rowToLedgerSnapshotPayload(businessId, row), {
      onConflict: 'business_id,sales_date',
    })
  if (error) throw error
}

export async function rebuildLedgerDaySnapshots(
  admin: SupabaseClient,
  businessId: string,
  startDateKey: string,
  endDateKey: string,
): Promise<{ cachedDays: number }> {
  const tz = await loadBusinessTimezone(admin, businessId)
  const salesDayEndTime = await loadSalesDayEndTime(admin, businessId)
  const [coreRows, manualCashMap, laborByDate] = await Promise.all([
    loadDailySalesCore(admin, businessId, tz, startDateKey, endDateKey, salesDayEndTime, {
      fillCalendarDays: true,
    }),
    loadManualCashMap(admin, businessId, startDateKey, endDateKey),
    loadLaborByDateForRange(admin, businessId, tz, startDateKey, endDateKey),
  ])
  const rows = rowsFromCore(coreRows, manualCashMap, laborByDate)
  let cachedDays = 0
  for (const row of rows) {
    if (!rowHasLedgerData(row)) continue
    await upsertLedgerDaySnapshot(admin, businessId, row)
    cachedDays += 1
  }
  return { cachedDays }
}

export async function refreshLedgerDaySnapshot(
  admin: SupabaseClient,
  businessId: string,
  salesDate: string,
) {
  const result = await rebuildLedgerDaySnapshots(admin, businessId, salesDate, salesDate)
  return result.cachedDays > 0
}

export async function saveManualLaborEntry(
  admin: SupabaseClient,
  businessId: string,
  salesDate: string,
  laborDollars: number | null,
  enteredBy: string,
  notes?: string | null,
) {
  if (laborDollars == null) {
    const { error } = await admin
      .from('daily_sales_manual_labor')
      .delete()
      .eq('business_id', businessId)
      .eq('sales_date', salesDate)
    if (error) throw error
    return { laborStatus: 'not_entered' as const, manualLabor: null }
  }

  const { error } = await admin
    .from('daily_sales_manual_labor')
    .upsert(
      {
        business_id: businessId,
        sales_date: salesDate,
        labor_dollars: laborDollars,
        notes: notes ?? null,
        entered_by: enteredBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'business_id,sales_date' },
    )

  if (error) throw error
  return { laborStatus: 'entered' as const, manualLabor: laborDollars }
}
