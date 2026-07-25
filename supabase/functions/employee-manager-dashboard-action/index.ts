import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import dayjs from 'https://esm.sh/dayjs@1.11.10'
import utc from 'https://esm.sh/dayjs@1.11.10/plugin/utc'
import timezone from 'https://esm.sh/dayjs@1.11.10/plugin/timezone'
import { collectPaymentsForSyncDate, fetchCloverTenders } from '../_shared/cloverApi.ts'
import { getCloverCredentialsForBusiness } from '../_shared/cloverBusinessCredentials.ts'
import { upsertCloverTransactionRow } from '../_shared/cloverTransactionStore.ts'
import {
  collectTransactionsForSyncDate,
  fetchAuthorizeNetTransactionDetails,
} from '../_shared/authorizeNetApi.ts'
import { getAuthorizeNetCredentialsForBusiness } from '../_shared/authorizeNetBusinessCredentials.ts'
import { upsertAuthorizeNetTransactionRow } from '../_shared/authorizeNetTransactionStore.ts'
import {
  computeLaborAndSubsidy,
  isSubsidyActiveOnDate,
  parseSubsidyConfig,
  premiumPerHourFromAssignments,
  weekStartSundayKey,
  type ClockLaborRow,
} from '../_shared/laborSubsidyCalc.ts'

dayjs.extend(utc)
dayjs.extend(timezone)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MANAGER_ROLES = new Set(['owner', 'manager', 'admin', 'hr_admin'])
const ABSENT_SHIFT_STATUSES = new Set(['sick', 'no_show', 'cancelled'])

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const token = authHeader.replace('Bearer ', '')
    const { data: authData, error: authError } = await admin.auth.getUser(token)
    if (authError || !authData.user?.email) return json({ error: 'Invalid user token' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = String(body.action || 'dashboard')
    const businessId = String(body.business_id || '').trim()
    if (!businessId) return json({ error: 'business_id is required' }, 400)

    const manager = await assertManager(admin, authData.user.email, authData.user.id, businessId)

    const { data: businessRow } = await admin
      .from('businesses')
      .select('id, name, timezone')
      .eq('id', businessId)
      .maybeSingle()

    const tz = businessRow?.timezone || 'America/Toronto'
    const calendarTodayKey = dayjs().tz(tz).format('YYYY-MM-DD')
    const salesDayEndTime = await loadSalesDayEndTime(admin, businessId)

    if (action === 'dashboard') {
      const selectedDateKey = String(body.date || calendarTodayKey).trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDateKey)) {
        return json({ error: 'date must be YYYY-MM-DD' }, 400)
      }

      const dailySales = await loadDailySales(admin, businessId, tz, 5, selectedDateKey, salesDayEndTime)
      const selectedDaySales = dailySales.find((d) => d.date === selectedDateKey)?.netSales ?? 0
      const { laborDollars, staff, subsidyCreditDollars, adjustedLaborDollars, subsidyBreakdown } =
        await loadTodayLaborAndStaff(admin, businessId, tz, selectedDateKey)
      const laborPercent = selectedDaySales > 0 ? (laborDollars / selectedDaySales) * 100 : 0
      const adjustedLaborPercent =
        selectedDaySales > 0 ? (adjustedLaborDollars / selectedDaySales) * 100 : laborPercent

      const monthAnchor = dayjs.tz(`${selectedDateKey}T12:00:00`, tz)
      const monthStartKey = monthAnchor.startOf('month').format('YYYY-MM-DD')
      const monthLabel = monthAnchor.format('MMMM')
      const lastYearMonthStartKey = monthAnchor.subtract(1, 'year').startOf('month').format('YYYY-MM-DD')
      const lastYearMonthEndKey = monthAnchor.subtract(1, 'year').format('YYYY-MM-DD')

      const salesMTD = await sumNetSalesForDateRange(
        admin,
        businessId,
        tz,
        monthStartKey,
        selectedDateKey,
        salesDayEndTime,
      )
      const salesLastYearMTD = await sumNetSalesForDateRange(
        admin,
        businessId,
        tz,
        lastYearMonthStartKey,
        lastYearMonthEndKey,
        salesDayEndTime,
      )
      const laborDollarsMTD = await loadLaborForDateRange(
        admin,
        businessId,
        tz,
        monthStartKey,
        selectedDateKey,
      )
      const laborPercentMTD = salesMTD > 0 ? (laborDollarsMTD / salesMTD) * 100 : 0
      const salesChangePercent =
        salesLastYearMTD > 0 ? ((salesMTD - salesLastYearMTD) / salesLastYearMTD) * 100 : null

      return json({
        ok: true,
        business: { id: businessId, name: businessRow?.name, timezone: tz },
        todayKey: calendarTodayKey,
        selectedDateKey,
        salesDayEndTime,
        dailySales,
        todayMetrics: {
          sales: selectedDaySales,
          laborDollars,
          laborPercent,
          subsidyCreditDollars,
          adjustedLaborDollars,
          adjustedLaborPercent,
          subsidyBreakdown,
        },
        monthMetrics: {
          monthLabel,
          salesMTD: Math.round(salesMTD * 100) / 100,
          salesLastYearMTD: Math.round(salesLastYearMTD * 100) / 100,
          salesChangePercent: salesChangePercent != null ? Math.round(salesChangePercent * 10) / 10 : null,
          laborDollarsMTD: Math.round(laborDollarsMTD * 100) / 100,
          laborPercentMTD: Math.round(laborPercentMTD * 10) / 10,
        },
        staff,
      })
    }

    if (action === 'day_sales_detail') {
      const dateKey = String(body.date || calendarTodayKey).trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        return json({ error: 'date must be YYYY-MM-DD' }, 400)
      }
      const detail = await loadDaySalesTenderDetail(admin, businessId, tz, dateKey, salesDayEndTime)
      return json({ ok: true, salesDayEndTime, ...detail })
    }

    if (action === 'mark_sick') {
      const shiftId = String(body.shift_id || '').trim()
      if (!shiftId) return json({ error: 'shift_id is required' }, 400)

      const { data: shift, error: shiftErr } = await admin
        .from('scheduling_shifts')
        .select('id, employee_id, shift_date, position, status')
        .eq('id', shiftId)
        .eq('business_id', businessId)
        .maybeSingle()

      if (shiftErr) throw shiftErr
      if (!shift) return json({ error: 'Shift not found' }, 404)
      if (shift.status === 'sick') return json({ ok: true, shift })

      const { data: updated, error: updateErr } = await admin
        .from('scheduling_shifts')
        .update({ status: 'sick', updated_at: new Date().toISOString() })
        .eq('id', shiftId)
        .eq('business_id', businessId)
        .select('*')
        .single()

      if (updateErr) throw updateErr

      await sendSchedulingNotification(admin, businessId, shift.employee_id, 'shift_marked_sick', {
        shiftId: shift.id,
        shiftDate: shift.shift_date,
        position: shift.position,
      })

      return json({ ok: true, shift: updated })
    }

    if (action === 'clock_in') {
      const shiftId = String(body.shift_id || '').trim()
      if (!shiftId) return json({ error: 'shift_id is required' }, 400)

      const clockInRaw = body.clock_in ? String(body.clock_in).trim() : dayjs().tz(tz).format('HH:mm')
      if (!/^\d{2}:\d{2}$/.test(clockInRaw)) {
        return json({ error: 'clock_in must be HH:mm' }, 400)
      }

      const { data: shift, error: shiftErr } = await admin
        .from('scheduling_shifts')
        .select('id, employee_id, status')
        .eq('id', shiftId)
        .eq('business_id', businessId)
        .maybeSingle()

      if (shiftErr) throw shiftErr
      if (!shift?.employee_id) return json({ error: 'Shift not found' }, 404)
      if (ABSENT_SHIFT_STATUSES.has(String(shift.status || '').toLowerCase())) {
        return json({ error: 'Cannot clock in a no-show, cancelled, or sick shift' }, 400)
      }

      const clockInIso = dayjs.tz(`${calendarTodayKey}T${clockInRaw}:00`, tz).toISOString()
      const activeOpen = await resolveOpenPunchesForToday(
        admin,
        businessId,
        String(shift.employee_id),
        tz,
        calendarTodayKey,
        manager.publicUserId,
      )

      if (activeOpen) {
        return json({ ok: true, timeClock: activeOpen, alreadyClockedIn: true })
      }

      const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
      const { data: inserted, error: insertErr } = await admin
        .from('scheduling_time_clocks')
        .insert({
          business_id: businessId,
          employee_id: shift.employee_id,
          clock_in_time: clockInIso,
          clock_out_time: null,
          notes: notes || null,
          adjusted_by: manager.publicUserId,
        })
        .select('*')
        .single()

      if (insertErr) throw insertErr
      return json({ ok: true, timeClock: inserted })
    }

    if (action === 'clear_clock_out') {
      const timeClockId = String(body.time_clock_id || '').trim()
      if (!timeClockId) return json({ error: 'time_clock_id is required' }, 400)

      const { data: existing, error: existingErr } = await admin
        .from('scheduling_time_clocks')
        .select('id, business_id, employee_id, clock_out_time')
        .eq('id', timeClockId)
        .eq('business_id', businessId)
        .maybeSingle()

      if (existingErr) throw existingErr
      if (!existing) return json({ error: 'Time card not found' }, 404)

      const { data: updated, error: updateErr } = await admin
        .from('scheduling_time_clocks')
        .update({
          clock_out_time: null,
          total_hours: null,
          clock_out_photo_url: null,
          clock_out_environment_photo_url: null,
          adjusted_by: manager.publicUserId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', timeClockId)
        .eq('business_id', businessId)
        .select('*')
        .single()

      if (updateErr) throw updateErr
      return json({ ok: true, timeClock: updated, clearedClockOut: true })
    }

    if (action === 'update_timecard') {
      const shiftId = String(body.shift_id || '').trim()
      const timeClockId = String(body.time_clock_id || '').trim()
      const dateKey = String(body.date || calendarTodayKey).trim()
      const clockIn = String(body.clock_in || '').trim()
      const hasClockOutField = body.clock_out !== undefined && body.clock_out !== null
      const clockOutRaw = hasClockOutField ? String(body.clock_out).trim() : ''
      const notes = typeof body.notes === 'string' ? body.notes.trim() : ''

      if (!clockIn || !/^\d{2}:\d{2}$/.test(clockIn)) {
        return json({ error: 'clock_in must be HH:mm' }, 400)
      }
      if (clockOutRaw && !/^\d{2}:\d{2}$/.test(clockOutRaw)) {
        return json({ error: 'clock_out must be HH:mm' }, 400)
      }

      const clockInIso = dayjs.tz(`${dateKey}T${clockIn}:00`, tz).toISOString()
      const clockOutIso = clockOutRaw ? dayjs.tz(`${dateKey}T${clockOutRaw}:00`, tz).toISOString() : null

      if (timeClockId) {
        const updatePayload: Record<string, unknown> = {
          clock_in_time: clockInIso,
          clock_out_time: clockOutIso,
          notes: notes || null,
          adjusted_by: manager.publicUserId,
          updated_at: new Date().toISOString(),
        }

        if (!clockOutIso) {
          updatePayload.total_hours = null
          updatePayload.clock_out_photo_url = null
          updatePayload.clock_out_environment_photo_url = null
        }

        const { data: updated, error } = await admin
          .from('scheduling_time_clocks')
          .update(updatePayload)
          .eq('id', timeClockId)
          .eq('business_id', businessId)
          .select('*')
          .single()

        if (error) throw error
        return json({ ok: true, timeClock: updated })
      }

      if (!shiftId) return json({ error: 'shift_id or time_clock_id is required' }, 400)

      const { data: shift, error: shiftErr } = await admin
        .from('scheduling_shifts')
        .select('id, employee_id, start_time, end_time, status')
        .eq('id', shiftId)
        .eq('business_id', businessId)
        .maybeSingle()

      if (shiftErr) throw shiftErr
      if (!shift?.employee_id) return json({ error: 'Shift not found' }, 404)

      const shiftStatus = String(body.shift_status || shift.status || 'scheduled')

      if (shiftStatus === 'sick') {
        await admin
          .from('scheduling_shifts')
          .update({ status: 'sick', notes: notes || null, updated_at: new Date().toISOString() })
          .eq('id', shiftId)
          .eq('business_id', businessId)
        return json({ ok: true, shiftId, markedSick: true })
      }

      if (ABSENT_SHIFT_STATUSES.has(String(shift.status || '').toLowerCase())) {
        return json(
          { error: 'Cannot add a time card for a no-show, cancelled, or sick shift. Update the shift status first.' },
          400,
        )
      }

      const { data: inserted, error: insertErr } = await admin
        .from('scheduling_time_clocks')
        .insert({
          business_id: businessId,
          employee_id: shift.employee_id,
          clock_in_time: clockInIso,
          clock_out_time: clockOutIso,
          notes: notes || null,
          adjusted_by: manager.publicUserId,
        })
        .select('*')
        .single()

      if (insertErr) throw insertErr
      return json({ ok: true, timeClock: inserted })
    }

    return json({ error: 'Invalid action' }, 400)
  } catch (error) {
    console.error('[employee-manager-dashboard-action]', error)
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})

async function assertManager(
  admin: ReturnType<typeof createClient>,
  email: string,
  authUserId: string,
  businessId: string,
) {
  const { data: publicUser, error: userErr } = await admin
    .from('users')
    .select('id, email, full_name')
    .eq('email', email)
    .maybeSingle()

  if (userErr || !publicUser?.id) throw new Error('Employee profile not found')

  const { data: bu } = await admin
    .from('business_users')
    .select('role')
    .eq('business_id', businessId)
    .eq('user_id', publicUser.id)
    .maybeSingle()

  if (bu?.role && MANAGER_ROLES.has(String(bu.role))) {
    return { publicUserId: publicUser.id }
  }

  const { data: ur } = await admin
    .from('user_roles')
    .select('role')
    .eq('business_id', businessId)
    .eq('user_id', publicUser.id)
    .eq('active', true)
    .maybeSingle()

  if (ur?.role && MANAGER_ROLES.has(String(ur.role))) {
    return { publicUserId: publicUser.id }
  }

  if (authUserId && authUserId !== publicUser.id) {
    const { data: buAuth } = await admin
      .from('business_users')
      .select('role')
      .eq('business_id', businessId)
      .eq('user_id', authUserId)
      .maybeSingle()

    if (buAuth?.role && MANAGER_ROLES.has(String(buAuth.role))) {
      return { publicUserId: publicUser.id }
    }
  }

  throw new Error('Manager access required')
}

const SUPABASE_PAGE_SIZE = 1000

async function fetchAllPaged<T extends Record<string, unknown>>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await fetchPage(from, from + SUPABASE_PAGE_SIZE - 1)
    if (error) throw error
    const batch = data || []
    rows.push(...batch)
    if (batch.length < SUPABASE_PAGE_SIZE) break
    from += SUPABASE_PAGE_SIZE
  }
  return rows
}

async function loadDailySales(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  tz: string,
  dayCount: number,
  anchorDateKey: string,
  salesDayEndTime: string,
) {
  const days: string[] = []
  for (let i = dayCount - 1; i >= 0; i -= 1) {
    days.push(dayjs.tz(`${anchorDateKey}T12:00:00`, tz).subtract(i, 'day').format('YYYY-MM-DD'))
  }

  const rangeStart = getBusinessDayWindowUtc(days[0], tz, salesDayEndTime).startUtc
  const rangeEnd = getBusinessDayWindowUtc(days[days.length - 1], tz, salesDayEndTime).endUtc
  const daySet = new Set(days)

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
      .select('total_refund_amount, created_at')
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
      .range(from, to),
  )

  const cloverRows = await fetchAllPaged<Record<string, unknown>>((from, to) =>
    admin
      .from('clover_transactions')
      .select('amount, status, transaction_kind, event_date, created_at, result')
      .eq('business_id', businessId)
      .gte('event_date', rangeStart)
      .lte('event_date', rangeEnd)
      .range(from, to),
  )

  const completed = sales.filter(
    (s) => s.payment_status === 'paid' || s.payment_status === 'completed',
  )

  const byDay: Record<string, { posGross: number; posRefunds: number; authorizeNet: number; clover: number }> = {}
  for (const d of days) byDay[d] = { posGross: 0, posRefunds: 0, authorizeNet: 0, clover: 0 }

  for (const sale of completed) {
    const key = businessDayKeyForIso(String(sale.created_at), tz, salesDayEndTime)
    if (!daySet.has(key)) continue
    byDay[key].posGross += Number(sale.total) || 0
  }

  for (const refund of refunds || []) {
    const key = businessDayKeyForIso(String(refund.created_at), tz, salesDayEndTime)
    if (!daySet.has(key)) continue
    byDay[key].posRefunds += Number(refund.total_refund_amount) || 0
  }

  for (const row of anetRows || []) {
    const ts = row.event_date || row.created_at
    if (!ts) continue
    const key = businessDayKeyForIso(String(ts), tz, salesDayEndTime)
    if (!daySet.has(key)) continue
    byDay[key].authorizeNet += authorizeNetSignedAmount(row)
  }

  for (const row of cloverRows || []) {
    const ts = row.event_date || row.created_at
    if (!ts) continue
    const key = businessDayKeyForIso(String(ts), tz, salesDayEndTime)
    if (!daySet.has(key)) continue
    byDay[key].clover += cloverSignedAmount(row)
  }

  return days.map((date) => {
    const posGross = byDay[date]?.posGross ?? 0
    const refundTotal = byDay[date]?.posRefunds ?? 0
    const posNetSales = posGross - refundTotal
    const authorizeNetSales = byDay[date]?.authorizeNet ?? 0
    const cloverSales = byDay[date]?.clover ?? 0
    const netSales = posNetSales + authorizeNetSales + cloverSales
    const label = dayjs.tz(`${date}T12:00:00`, tz).format('ddd')
    return {
      date,
      label,
      grossSales: posGross,
      netSales,
      refundTotal,
      posNetSales,
      authorizeNetSales,
      cloverSales,
    }
  })
}

async function sumNetSalesForDateRange(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  tz: string,
  startDateKey: string,
  endDateKey: string,
  salesDayEndTime: string,
): Promise<number> {
  const start = dayjs.tz(`${startDateKey}T12:00:00`, tz)
  const end = dayjs.tz(`${endDateKey}T12:00:00`, tz)
  const dayCount = end.diff(start, 'day') + 1
  if (dayCount <= 0) return 0

  const daily = await loadDailySales(admin, businessId, tz, dayCount, endDateKey, salesDayEndTime)
  return daily.reduce((sum, row) => sum + (row.netSales || 0), 0)
}

async function loadLaborForDateRange(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  tz: string,
  startDateKey: string,
  endDateKey: string,
): Promise<number> {
  const startIso = dayjs.tz(`${startDateKey}T00:00:00`, tz).toISOString()
  const endIso = dayjs.tz(`${endDateKey}T23:59:59.999`, tz).toISOString()
  const nowIso = new Date().toISOString()

  const { data: clocks, error: clocksErr } = await admin
    .from('scheduling_time_clocks')
    .select(`
      id, employee_id, clock_in_time, clock_out_time, break_duration_minutes,
      users!scheduling_time_clocks_employee_id_fkey ( id, wage )
    `)
    .eq('business_id', businessId)
    .gte('clock_in_time', startIso)
    .lte('clock_in_time', endIso)
    .not('employee_id', 'is', null)

  if (clocksErr) throw clocksErr

  const employeeIds = [...new Set((clocks || []).map((c) => String(c.employee_id)).filter(Boolean))]
  const premiumsByEmployee: Record<string, Array<Record<string, unknown>>> = {}
  const premiumRateTypeByName: Record<string, string> = {}

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

    const { data: shiftPremiums } = await admin
      .from('hr_shift_premiums')
      .select('name, rate_type')
      .eq('business_id', businessId)
      .eq('is_active', true)

    for (const sp of shiftPremiums || []) {
      if (sp?.name) premiumRateTypeByName[String(sp.name)] = String(sp.rate_type || 'fixed_amount')
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

  let laborDollars = 0
  for (const clock of clocks || []) {
    const empId = String(clock.employee_id)
    const user = clock.users as Record<string, unknown> | null
    const baseWage = parseFloat(String(user?.wage ?? 0)) || 0
    const dayKey = punchDayKey(String(clock.clock_in_time), tz)
    const outIso =
      clock.clock_out_time ||
      (dayKey === endDateKey
        ? nowIso
        : dayjs.tz(`${dayKey}T23:59:59`, tz).toISOString())
    const breakRows = breaksByClock[String(clock.id)] || []
    const paidMin = paidMinutesForClock(
      String(clock.clock_in_time),
      String(outIso),
      breakRows,
      Number(clock.break_duration_minutes) || 0,
    )
    const paidHours = paidMin / 60
    if (paidHours <= 0) continue

    const assignments = (premiumsByEmployee[empId] || []).map((row) => ({
      ...row,
      rate_type: premiumRateTypeByName[String(row.premium_name)] || 'fixed_amount',
    }))
    const premiumPerHour = premiumPerHourFromAssignments(baseWage, assignments)
    laborDollars += paidHours * (baseWage + premiumPerHour)
  }

  return laborDollars
}

const TENDER_LABELS: Record<string, string> = {
  cash: 'Cash',
  credit: 'Credit',
  debit: 'Debit',
  other: 'Other',
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

function businessDayKeyForIso(iso: string, tz: string, salesDayEndTime: string): string {
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

function getBusinessDayWindowUtc(
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

async function loadSalesDayEndTime(
  admin: ReturnType<typeof createClient>,
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

function posPaymentTenderCategory(method: string, notes: string | null | undefined): string {
  const m = String(method || '').toLowerCase().trim()
  if (m === 'cash') return 'cash'
  if (m === 'debit') return 'debit'
  if (m === 'card' || m === 'credit') return 'credit'
  if (m === 'helcim_terminal' || m === 'helcim') {
    if (notes) {
      try {
        const parsed = JSON.parse(notes) as { helcim?: { cardType?: string } }
        const cardType = String(parsed?.helcim?.cardType || '').toLowerCase()
        if (cardType.includes('debit') || cardType.includes('interac')) return 'debit'
        if (cardType) return 'credit'
      } catch {
        /* ignore */
      }
    }
    return 'credit'
  }
  return 'other'
}

function posRefundTenderCategory(method: string | null | undefined): string {
  const m = String(method || '').toLowerCase().trim()
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

function addTenderAmount(buckets: Record<string, number>, key: string, amount: number) {
  if (!amount || Number.isNaN(amount)) return
  buckets[key] = (buckets[key] || 0) + amount
}

async function refreshCloverDaySales(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  dateKey: string,
  tz: string,
) {
  const creds = await getCloverCredentialsForBusiness(admin, businessId)
  if (!creds) return

  try {
    const payments = await collectPaymentsForSyncDate(creds, dateKey, tz)
    for (const details of payments) {
      await upsertCloverTransactionRow(admin, {
        businessId,
        details,
        paymentSource: creds.paymentSource,
        eventDate: details.createdTime ?? details.modifiedTime,
      })
    }
  } catch (e) {
    console.warn('[employee-manager-dashboard-action] clover day refresh failed', e)
  }
}

async function refreshAuthorizeNetDaySales(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  syncDate: string,
) {
  const creds = await getAuthorizeNetCredentialsForBusiness(admin, businessId)
  if (!creds) return

  try {
    const summaries = await collectTransactionsForSyncDate(creds, syncDate)
    for (const summary of summaries) {
      const details = await fetchAuthorizeNetTransactionDetails(creds, summary.transId)
      if (!details) continue
      await upsertAuthorizeNetTransactionRow(admin, {
        businessId,
        details,
        paymentSource: creds.paymentSource,
        eventDate: details.submitTimeUTC ?? details.submitTimeLocal ?? summary.submitTimeUTC ?? summary.submitTimeLocal,
        summaryStatus: summary.transactionStatus,
      })
    }
  } catch (e) {
    console.warn('[employee-manager-dashboard-action] authorize.net day refresh failed', e)
  }
}

function tenderRowsFromBuckets(buckets: Record<string, number>) {
  return Object.entries(buckets)
    .filter(([, amount]) => Math.abs(amount) > 0.004)
    .map(([key, amount]) => ({
      key,
      label: TENDER_LABELS[key] || key,
      amount: Math.round(amount * 100) / 100,
    }))
    .sort((a, b) => b.amount - a.amount)
}

function mergeTenderBuckets(target: Record<string, number>, source: Record<string, number>) {
  for (const [key, amount] of Object.entries(source)) {
    addTenderAmount(target, key, amount)
  }
}

function processorNetTotal(buckets: Record<string, number>) {
  const total = Object.values(buckets).reduce((sum, n) => sum + n, 0)
  return Math.round(total * 100) / 100
}

async function loadDaySalesTenderDetail(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  tz: string,
  dateKey: string,
  salesDayEndTime: string,
) {
  const { startUtc: dayStart, endUtc: dayEnd } = getBusinessDayWindowUtc(dateKey, tz, salesDayEndTime)
  const dayLabel = dayjs.tz(`${dateKey}T12:00:00`, tz).format('ddd, MMM D')

  const syncDates = [
    dayjs.tz(`${dateKey}T12:00:00`, tz).format('YYYY-MM-DD'),
    dayjs.tz(`${dateKey}T12:00:00`, tz).subtract(1, 'day').format('YYYY-MM-DD'),
  ]
  for (const syncDate of syncDates) {
    await refreshCloverDaySales(admin, businessId, syncDate, tz)
    await refreshAuthorizeNetDaySales(admin, businessId, syncDate)
  }

  const { data: payments, error: payErr } = await admin
    .from('pos_payments')
    .select('amount, payment_method, notes, created_at')
    .eq('business_id', businessId)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd)

  if (payErr) throw payErr

  const { data: refunds, error: refundErr } = await admin
    .from('pos_refunds')
    .select('total_refund_amount, refund_method, created_at')
    .eq('business_id', businessId)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd)

  if (refundErr) throw refundErr

  const { data: anetRows, error: anetErr } = await admin
    .from('authorize_net_transactions')
    .select('amount, status, transaction_kind, event_date, created_at')
    .eq('business_id', businessId)
    .gte('event_date', dayStart)
    .lte('event_date', dayEnd)

  if (anetErr) throw anetErr

  const { data: cloverRows, error: cloverErr } = await admin
    .from('clover_transactions')
    .select('amount, status, transaction_kind, event_date, created_at, result, raw_details')
    .eq('business_id', businessId)
    .gte('event_date', dayStart)
    .lte('event_date', dayEnd)

  if (cloverErr) throw cloverErr

  const posBuckets: Record<string, number> = {}
  for (const payment of payments || []) {
    const key = businessDayKeyForIso(String(payment.created_at), tz, salesDayEndTime)
    if (key !== dateKey) continue
    const tender = posPaymentTenderCategory(
      String(payment.payment_method || ''),
      typeof payment.notes === 'string' ? payment.notes : null,
    )
    addTenderAmount(posBuckets, tender, Number(payment.amount) || 0)
  }

  for (const refund of refunds || []) {
    const key = businessDayKeyForIso(String(refund.created_at), tz, salesDayEndTime)
    if (key !== dateKey) continue
    const tender = posRefundTenderCategory(refund.refund_method as string | null)
    addTenderAmount(posBuckets, tender, -(Number(refund.total_refund_amount) || 0))
  }

  const authorizeBuckets: Record<string, number> = {}
  for (const row of anetRows || []) {
    const ts = row.event_date || row.created_at
    if (!ts) continue
    const key = businessDayKeyForIso(String(ts), tz, salesDayEndTime)
    if (key !== dateKey) continue
    addTenderAmount(authorizeBuckets, 'credit', authorizeNetSignedAmount(row))
  }

  let cloverTenderMap: Record<string, { label: string; labelKey: string }> = {}
  const cloverCreds = await getCloverCredentialsForBusiness(admin, businessId)
  if (cloverCreds) {
    try {
      cloverTenderMap = await fetchCloverTenders(cloverCreds)
    } catch (e) {
      console.warn('[employee-manager-dashboard-action] clover tenders fetch failed', e)
    }
  }

  const cloverBuckets: Record<string, number> = {}
  for (const row of cloverRows || []) {
    const ts = row.event_date || row.created_at
    if (!ts) continue
    const key = businessDayKeyForIso(String(ts), tz, salesDayEndTime)
    if (key !== dateKey) continue
    const signed = cloverSignedAmount(row as Record<string, unknown>)
    if (!signed) continue

    const raw = row.raw_details as Record<string, unknown> | null
    const tenderKey = cloverTenderKeyFromRaw(raw, cloverTenderMap)
    addTenderAmount(cloverBuckets, tenderKey, signed)
  }

  const totalBuckets: Record<string, number> = {}
  mergeTenderBuckets(totalBuckets, posBuckets)
  mergeTenderBuckets(totalBuckets, authorizeBuckets)
  mergeTenderBuckets(totalBuckets, cloverBuckets)

  const byProcessor = [
    {
      processor: 'tavari',
      label: 'Tavari POS',
      netTotal: processorNetTotal(posBuckets),
      tenders: tenderRowsFromBuckets(posBuckets),
    },
    {
      processor: 'authorize_net',
      label: 'Authorize.net (Bookeo)',
      netTotal: processorNetTotal(authorizeBuckets),
      tenders: tenderRowsFromBuckets(authorizeBuckets),
    },
    {
      processor: 'clover',
      label: 'Clover POS',
      netTotal: processorNetTotal(cloverBuckets),
      tenders: tenderRowsFromBuckets(cloverBuckets),
    },
  ].filter((p) => p.netTotal !== 0 || p.tenders.length > 0)

  const netSales = processorNetTotal(totalBuckets)

  return {
    date: dateKey,
    label: dayLabel,
    netSales,
    byProcessor,
    byTender: tenderRowsFromBuckets(totalBuckets),
  }
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

function unpaidBreakMinutes(breakRows: Array<Record<string, unknown>>) {
  let total = 0
  for (const b of breakRows) {
    if (b.is_paid || b.break_type === 'paid') continue
    let dm = b.duration_minutes as number | string | null
    if ((dm == null || dm === '') && b.break_start_at && b.break_end_at) {
      const derived = dayjs(String(b.break_end_at)).diff(dayjs(String(b.break_start_at)), 'minute')
      dm = derived > 0 ? derived : 0
    }
    if (dm != null && dm !== '' && !Number.isNaN(parseFloat(String(dm)))) {
      total += parseFloat(String(dm))
    }
  }
  return total
}

function paidMinutesForClock(
  clockInIso: string,
  clockOutIso: string,
  breakRows: Array<Record<string, unknown>>,
  breakDurationMinutes: number,
) {
  const gross = dayjs(clockOutIso).diff(dayjs(clockInIso), 'minute')
  if (gross <= 0) return 0
  let unpaid = unpaidBreakMinutes(breakRows)
  if (!breakRows.length) unpaid = Number(breakDurationMinutes) || 0
  return Math.max(0, gross - unpaid)
}

function isActiveEmployeeForSubsidyList(
  membership: Record<string, unknown> | null | undefined,
  user: Record<string, unknown> | null | undefined,
  dateKey: string,
): boolean {
  const status = String(
    membership?.employment_status ?? user?.employment_status ?? 'active',
  )
    .toLowerCase()
    .trim()
  if (status === 'terminated' || status === 'suspended') return false

  const termRaw = membership?.termination_date ?? user?.termination_date
  if (termRaw) {
    const termKey = String(termRaw).slice(0, 10)
    if (termKey && dateKey >= termKey) return false
  }

  return true
}

async function loadTodayLaborAndStaff(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  tz: string,
  todayKey: string,
) {
  const dayStart = dayjs.tz(`${todayKey}T00:00:00`, tz).toISOString()
  const dayEnd = dayjs.tz(`${todayKey}T23:59:59.999`, tz).toISOString()
  const nowIso = new Date().toISOString()

  const { data: shifts, error: shiftsErr } = await admin
    .from('scheduling_shifts')
    .select(`
      id, employee_id, shift_date, start_time, end_time, position, status, notes, is_published,
      users!scheduling_shifts_employee_id_fkey ( id, full_name, first_name, last_name, wage, position )
    `)
    .eq('business_id', businessId)
    .eq('shift_date', todayKey)
    .not('employee_id', 'is', null)

  if (shiftsErr) throw shiftsErr

  const { data: clocks, error: clocksErr } = await admin
    .from('scheduling_time_clocks')
    .select(`
      id, employee_id, clock_in_time, clock_out_time, break_duration_minutes, notes,
      users!scheduling_time_clocks_employee_id_fkey ( id, full_name, first_name, last_name, wage, position )
    `)
    .eq('business_id', businessId)
    .gte('clock_in_time', dayStart)
    .lte('clock_in_time', dayEnd)
    .order('clock_in_time', { ascending: false })

  if (clocksErr) throw clocksErr

  const clockIds = (clocks || []).map((c) => c.id)
  let breaksByClock: Record<string, Array<Record<string, unknown>>> = {}
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

  let laborDollars = 0
  const staff: Array<Record<string, unknown>> = []
  const clockByEmployee: Record<string, typeof clocks> = {}
  const weekClockLaborRows: ClockLaborRow[] = []

  const weekStartKey = weekStartSundayKey(todayKey, tz)
  const weekStartIso = dayjs.tz(`${weekStartKey}T00:00:00`, tz).toISOString()
  const dayEndIso = dayjs.tz(`${todayKey}T23:59:59.999`, tz).toISOString()

  const { data: weekClocks, error: weekClocksErr } = await admin
    .from('scheduling_time_clocks')
    .select(`
      id, employee_id, clock_in_time, clock_out_time, break_duration_minutes,
      users!scheduling_time_clocks_employee_id_fkey (
        id, full_name, first_name, last_name, wage,
        labor_subsidy_enabled, labor_subsidy_partner, labor_subsidy_wage_cap,
        labor_subsidy_max_hours_per_week, labor_subsidy_start_date, labor_subsidy_end_date
      )
    `)
    .eq('business_id', businessId)
    .gte('clock_in_time', weekStartIso)
    .lte('clock_in_time', dayEndIso)
    .not('employee_id', 'is', null)

  if (weekClocksErr) throw weekClocksErr

  const weekEmployeeIds = [
    ...new Set((weekClocks || []).map((c) => String(c.employee_id)).filter(Boolean)),
  ]

  const premiumsByEmployee: Record<string, Array<Record<string, unknown>>> = {}
  const premiumRateTypeByName: Record<string, string> = {}

  if (weekEmployeeIds.length) {
    const { data: premiumRows } = await admin
      .from('hrpayroll_employee_premiums')
      .select('user_id, premium_name, premium_rate, applies_to_all_hours, is_active, approval_status')
      .eq('business_id', businessId)
      .in('user_id', weekEmployeeIds)
      .eq('is_active', true)
      .or('approval_status.is.null,approval_status.eq.approved')

    for (const row of premiumRows || []) {
      const uid = String(row.user_id)
      if (!premiumsByEmployee[uid]) premiumsByEmployee[uid] = []
      premiumsByEmployee[uid].push(row as Record<string, unknown>)
    }

    const { data: shiftPremiums } = await admin
      .from('hr_shift_premiums')
      .select('name, rate_type')
      .eq('business_id', businessId)
      .eq('is_active', true)

    for (const sp of shiftPremiums || []) {
      if (sp?.name) premiumRateTypeByName[String(sp.name)] = String(sp.rate_type || 'fixed_amount')
    }
  }

  const weekBreakIds = (weekClocks || []).map((c) => c.id)
  let weekBreaksByClock: Record<string, Array<Record<string, unknown>>> = {}
  if (weekBreakIds.length) {
    const { data: weekBreaks } = await admin
      .from('scheduling_break_tracking')
      .select('*')
      .in('time_clock_id', weekBreakIds)

    for (const b of weekBreaks || []) {
      const id = String(b.time_clock_id)
      if (!weekBreaksByClock[id]) weekBreaksByClock[id] = []
      weekBreaksByClock[id].push(b as Record<string, unknown>)
    }
  }

  const subsidyByEmployee: Record<string, ReturnType<typeof parseSubsidyConfig>> = {}
  const employeeNameById: Record<string, string> = {}

  for (const clock of weekClocks || []) {
    const empId = String(clock.employee_id)
    const user = clock.users as Record<string, unknown> | null
    const employeeName =
      String(user?.full_name || '').trim() ||
      [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
      'Employee'
    employeeNameById[empId] = employeeName
    const baseWage = parseFloat(String(user?.wage ?? 0)) || 0
    const dayKey = punchDayKey(String(clock.clock_in_time), tz)
    const outIso = clock.clock_out_time || (dayKey === todayKey ? nowIso : dayjs.tz(`${dayKey}T23:59:59`, tz).toISOString())
    const breakRows = weekBreaksByClock[String(clock.id)] || []
    const paidMin = paidMinutesForClock(
      String(clock.clock_in_time),
      String(outIso),
      breakRows,
      Number(clock.break_duration_minutes) || 0,
    )

    const assignments = (premiumsByEmployee[empId] || []).map((row) => ({
      ...row,
      rate_type: premiumRateTypeByName[String(row.premium_name)] || 'fixed_amount',
    }))
    const premiumPerHour = premiumPerHourFromAssignments(baseWage, assignments)

    weekClockLaborRows.push({
      employeeId: empId,
      clockInIso: String(clock.clock_in_time),
      paidMinutes: paidMin,
      baseWage,
      premiumPerHour,
      dayKey,
    })

    const parsed = parseSubsidyConfig(user)
    if (parsed) subsidyByEmployee[empId] = parsed
  }

  const activeSubsidyByEmployee: Record<string, ReturnType<typeof parseSubsidyConfig>> = {}
  const { data: businessSubsidyUsers, error: businessSubsidyErr } = await admin
    .from('business_users')
    .select(`
      user_id, employment_status, termination_date,
      users!business_users_user_id_fkey (
        id, full_name, first_name, last_name, employment_status, termination_date,
        labor_subsidy_enabled, labor_subsidy_partner, labor_subsidy_wage_cap,
        labor_subsidy_max_hours_per_week, labor_subsidy_start_date, labor_subsidy_end_date
      )
    `)
    .eq('business_id', businessId)

  if (businessSubsidyErr) throw businessSubsidyErr

  for (const row of businessSubsidyUsers || []) {
    const user = row.users as Record<string, unknown> | null
    if (!user?.id) continue
    if (!isActiveEmployeeForSubsidyList(row as Record<string, unknown>, user, todayKey)) continue
    const empId = String(user.id)
    const parsed = parseSubsidyConfig(user)
    if (!parsed || !isSubsidyActiveOnDate(parsed, todayKey)) continue
    activeSubsidyByEmployee[empId] = parsed
    employeeNameById[empId] =
      String(user.full_name || '').trim() ||
      [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
      employeeNameById[empId] ||
      'Employee'
  }

  const laborMetrics = computeLaborAndSubsidy({
    clocks: weekClockLaborRows,
    subsidyByEmployee,
    todayKey,
  })
  laborDollars = laborMetrics.laborDollarsToday

  for (const clock of clocks || []) {
    const empId = String(clock.employee_id)
    if (!clockByEmployee[empId]) clockByEmployee[empId] = []
    clockByEmployee[empId].push(clock)
  }

  const subsidyCreditDollars = laborMetrics.subsidyCreditToday
  const adjustedLaborDollars = laborMetrics.adjustedLaborDollars

  const breakdownByEmployee = new Map(
    (laborMetrics.subsidyBreakdown || []).map((row) => [row.employeeId, row]),
  )

  const subsidyBreakdown = Object.keys(activeSubsidyByEmployee).map((employeeId) => {
    const config = activeSubsidyByEmployee[employeeId]
    const existing = breakdownByEmployee.get(employeeId)
    return {
      employeeId,
      weeklySubsidizedHours: existing?.weeklySubsidizedHours ?? 0,
      weeklyCapHours: config.maxHoursPerWeek,
      todaySubsidyCredit: existing?.todaySubsidyCredit ?? 0,
      todayWorkedHours: existing?.todayWorkedHours ?? 0,
      capReached: existing?.capReached ?? false,
      employeeName: employeeNameById[employeeId] || 'Employee',
      partner: config.partner || null,
    }
  })

  const publishedShifts = (shifts || []).filter((s) => s.is_published !== false)
  const employeeIds = publishedShifts.map((s) => String(s.employee_id)).filter(Boolean)

  // Auto-close forgotten open punches from prior calendar days so manager + labor views match reality.
  if (employeeIds.length) {
    const { data: staleCandidates } = await admin
      .from('scheduling_time_clocks')
      .select('id, employee_id, clock_in_time, notes')
      .eq('business_id', businessId)
      .in('employee_id', employeeIds)
      .is('clock_out_time', null)

    for (const punch of staleCandidates || []) {
      const punchDay = punchDayKey(String(punch.clock_in_time), tz)
      if (punchDay === todayKey) continue
      const staleOutIso = dayjs.tz(`${punchDay}T23:59:59`, tz).toISOString()
      const existingNotes = typeof punch.notes === 'string' ? punch.notes.trim() : ''
      const staleNote = `System auto-closed stale open punch from ${punchDay} (no clock-out recorded).`
      const notes = existingNotes ? `${existingNotes}\n${staleNote}` : staleNote
      await admin
        .from('scheduling_time_clocks')
        .update({
          clock_out_time: staleOutIso,
          notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', punch.id)
        .eq('business_id', businessId)
    }
  }

  let openPunchByEmployee: Record<string, { id: string; clock_in_time: string }> = {}
  if (employeeIds.length) {
    const { data: openPunches } = await admin
      .from('scheduling_time_clocks')
      .select('id, employee_id, clock_in_time')
      .eq('business_id', businessId)
      .in('employee_id', employeeIds)
      .is('clock_out_time', null)

    for (const punch of openPunches || []) {
      const empId = String(punch.employee_id)
      if (!openPunchByEmployee[empId]) {
        openPunchByEmployee[empId] = {
          id: String(punch.id),
          clock_in_time: String(punch.clock_in_time),
        }
      }
    }
  }

  for (const shift of publishedShifts) {
    const empId = String(shift.employee_id)
    const user = shift.users as Record<string, unknown> | null
    const name =
      String(user?.full_name || '').trim() ||
      [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
      'Employee'

    const openPunch = openPunchByEmployee[empId]
    const openPunchDay = openPunch ? punchDayKey(openPunch.clock_in_time, tz) : null
    const openPunchIsToday = openPunchDay === todayKey
    const employeeClocks = clockByEmployee[empId] || []
    const todayOpenFromClocks = employeeClocks.find((c) => !c.clock_out_time)
    const activeClock = todayOpenFromClocks || (openPunchIsToday && openPunch
      ? { id: openPunch.id, clock_in_time: openPunch.clock_in_time, clock_out_time: null }
      : null)
    const latestClock = employeeClocks[0] || (openPunchIsToday && openPunch
      ? { id: openPunch.id, clock_in_time: openPunch.clock_in_time, clock_out_time: null }
      : null)

    staff.push({
      shiftId: shift.id,
      timeClockId: activeClock?.id || latestClock?.id || null,
      employeeId: empId,
      employeeName: name,
      position: shift.position || user?.position || null,
      shiftStart: shift.start_time,
      shiftEnd: shift.end_time,
      shiftStatus: shift.status,
      clockIn: latestClock?.clock_in_time || activeClock?.clock_in_time || null,
      clockOut: latestClock?.clock_out_time || null,
      isClockedIn: Boolean(activeClock),
      hasClock: employeeClocks.length > 0 || Boolean(openPunchIsToday && openPunch),
      isScheduledOnly: employeeClocks.length === 0 && !openPunchIsToday && shift.status !== 'sick',
    })
  }

  staff.sort((a, b) => {
    const ta = String(a.shiftStart || '')
    const tb = String(b.shiftStart || '')
    return ta.localeCompare(tb)
  })

  return {
    laborDollars: Math.round(laborDollars * 100) / 100,
    staff,
    subsidyCreditDollars,
    adjustedLaborDollars,
    subsidyBreakdown,
  }
}

const STALE_OPEN_PUNCH_NOTE = 'System auto-closed stale open punch (no clock-out recorded).'

function punchDayKey(clockInIso: string, tz: string): string {
  return dayjs(clockInIso).tz(tz).format('YYYY-MM-DD')
}

async function resolveOpenPunchesForToday(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  employeeId: string,
  tz: string,
  todayKey: string,
  adjustedBy?: string | null,
) {
  const { data: openPunches, error } = await admin
    .from('scheduling_time_clocks')
    .select('*')
    .eq('business_id', businessId)
    .eq('employee_id', employeeId)
    .is('clock_out_time', null)
    .order('clock_in_time', { ascending: false })

  if (error) throw error

  let activeToday: Record<string, unknown> | null = null
  for (const punch of openPunches || []) {
    const punchDay = punchDayKey(String(punch.clock_in_time), tz)
    if (punchDay === todayKey) {
      if (!activeToday) activeToday = punch as Record<string, unknown>
      continue
    }
    const staleOutIso = dayjs.tz(`${punchDay}T23:59:59`, tz).toISOString()
    const existingNotes = typeof punch.notes === 'string' ? punch.notes.trim() : ''
    const notes = existingNotes ? `${existingNotes}\n${STALE_OPEN_PUNCH_NOTE}` : STALE_OPEN_PUNCH_NOTE
    const { error: updErr } = await admin
      .from('scheduling_time_clocks')
      .update({
        clock_out_time: staleOutIso,
        notes,
        adjusted_by: adjustedBy || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', punch.id)
      .eq('business_id', businessId)
    if (updErr) throw updErr
  }
  return activeToday
}

async function sendSchedulingNotification(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  employeeId: string,
  eventKey: string,
  context: Record<string, unknown>,
) {
  try {
    const { data: secretRow } = await admin
      .from('system_runtime_secrets')
      .select('secret_value')
      .eq('key_name', 'scheduling_attendance_scan_secret')
      .maybeSingle()

    await fetch(`${SUPABASE_URL}/functions/v1/scheduling-send-notification`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        ...(secretRow?.secret_value ? { 'x-scheduling-attendance-secret': secretRow.secret_value } : {}),
      },
      body: JSON.stringify({
        businessId,
        eventKey,
        employeeId,
        context,
      }),
    })
  } catch (e) {
    console.warn('[employee-manager-dashboard-action] notification failed', e)
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
