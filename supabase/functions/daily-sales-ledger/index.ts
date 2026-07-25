import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import dayjs from 'https://esm.sh/dayjs@1.11.10'
import utc from 'https://esm.sh/dayjs@1.11.10/plugin/utc'
import timezone from 'https://esm.sh/dayjs@1.11.10/plugin/timezone'
import {
  backfillExternalSales,
  buildLedgerPayload,
  defaultRankingsFromDate,
  getExternalSalesSyncStatus,
  loadDailySalesCore,
  loadLaborAndSubsidyByDateForRange,
  loadSalesDayEndTime,
  rebuildLedgerDaySnapshots,
  saveManualCashEntry,
  saveManualLaborEntry,
  computeTotalSales,
  loadLaborForDateRange,
  type DailySalesRow,
} from '../_shared/dailySalesLedger.ts'

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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function clampRankingsFrom(endDateKey: string, tz: string, requested?: string): string {
  const fallback = defaultRankingsFromDate(endDateKey, tz)
  const raw = String(requested || fallback).trim()
  const minAllowed = dayjs.tz(`${endDateKey}T12:00:00`, tz).subtract(2, 'year').startOf('year').format('YYYY-MM-DD')
  if (!DATE_RE.test(raw)) return fallback
  return raw < minAllowed ? minAllowed : raw
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const body = await req.json().catch(() => ({}))
    const action = String(body.action || 'ledger')
    const businessId = String(body.business_id || '').trim()
    if (!businessId) return json({ error: 'business_id is required' }, 400)

    const token = authHeader.replace('Bearer ', '')
    const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY
    let manager: { publicUserId: string }
    if (isServiceRole) {
      manager = { publicUserId: 'service-role' }
    } else {
      const { data: authData, error: authError } = await admin.auth.getUser(token)
      if (authError || !authData.user?.email) return json({ error: 'Invalid user token' }, 401)
      manager = await assertManager(admin, authData.user.email, authData.user.id, businessId)
    }

    const { data: businessRow } = await admin
      .from('businesses')
      .select('id, name, timezone')
      .eq('id', businessId)
      .maybeSingle()

    const tz = businessRow?.timezone || 'America/Toronto'
    const salesDayEndTime = await loadSalesDayEndTime(admin, businessId)
    const calendarTodayKey = dayjs().tz(tz).format('YYYY-MM-DD')

    if (action === 'sync_status') {
      const syncStatus = await getExternalSalesSyncStatus(admin, businessId, tz)
      return json({
        ok: true,
        syncStatus,
        salesDayEndTime,
        timezone: tz,
      })
    }

    if (action === 'labor_for_range') {
      const startDate = String(body.start_date || dayjs.tz(calendarTodayKey, tz).startOf('month').format('YYYY-MM-DD')).trim()
      const endDate = String(body.end_date || calendarTodayKey).trim()
      if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
        return json({ error: 'start_date and end_date must be YYYY-MM-DD' }, 400)
      }
      const { laborByDate, subsidyByDate } = await loadLaborAndSubsidyByDateForRange(
        admin, businessId, tz, startDate, endDate,
      )
      return json({ ok: true, laborByDate, subsidyByDate, salesDayEndTime, timezone: tz })
    }

    if (action === 'ledger') {
      const startDate = String(body.start_date || dayjs.tz(calendarTodayKey, tz).startOf('month').format('YYYY-MM-DD')).trim()
      const endDate = String(body.end_date || calendarTodayKey).trim()
      const rankingsFrom = clampRankingsFrom(endDate, tz, body.rankings_from)

      if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
        return json({ error: 'start_date and end_date must be YYYY-MM-DD' }, 400)
      }

      const payload = await buildLedgerPayload(
        admin,
        businessId,
        tz,
        salesDayEndTime,
        startDate,
        endDate,
        rankingsFrom,
      )

      const syncStatus = await getExternalSalesSyncStatus(admin, businessId, tz)

      return json({
        ok: true,
        business: { id: businessId, name: businessRow?.name, timezone: tz },
        salesDayEndTime,
        todayKey: calendarTodayKey,
        startDate,
        endDate,
        rankingsFrom: payload.rankingsFrom,
        summaryFrom: payload.summaryFrom,
        rows: payload.rows,
        monthlySummary: payload.monthlySummary,
        ytdSummary: payload.ytdSummary,
        syncStatus,
      })
    }

    if (action === 'save_manual_cash') {
      const salesDate = String(body.sales_date || '').trim()
      if (!DATE_RE.test(salesDate)) return json({ error: 'sales_date must be YYYY-MM-DD' }, 400)

      let cashCollected: number | null = null
      if (body.cash_collected !== undefined && body.cash_collected !== null && body.cash_collected !== '') {
        const parsed = Number(body.cash_collected)
        if (!Number.isFinite(parsed)) return json({ error: 'cash_collected must be a number' }, 400)
        cashCollected = Math.round(parsed * 100) / 100
      }

      const saved = await saveManualCashEntry(
        admin,
        businessId,
        salesDate,
        cashCollected,
        manager.publicUserId,
        body.notes != null ? String(body.notes) : null,
      )

      return json({
        ok: true,
        sales_date: salesDate,
        manualCash: saved.manualCash,
        cashStatus: saved.cashStatus,
      })
    }

    if (action === 'save_manual_labor') {
      const salesDate = String(body.sales_date || '').trim()
      if (!DATE_RE.test(salesDate)) return json({ error: 'sales_date must be YYYY-MM-DD' }, 400)

      let laborDollars: number | null = null
      if (body.labor_dollars !== undefined && body.labor_dollars !== null && body.labor_dollars !== '') {
        const parsed = Number(body.labor_dollars)
        if (!Number.isFinite(parsed)) return json({ error: 'labor_dollars must be a number' }, 400)
        laborDollars = Math.round(parsed * 100) / 100
      }

      const saved = await saveManualLaborEntry(
        admin,
        businessId,
        salesDate,
        laborDollars,
        manager.publicUserId,
        body.notes != null ? String(body.notes) : null,
      )

      return json({
        ok: true,
        sales_date: salesDate,
        manualLabor: saved.manualLabor,
        laborStatus: saved.laborStatus,
      })
    }

    if (action === 'rebuild_ledger_days') {
      const startDate = String(body.start_date || '').trim()
      const endDate = String(body.end_date || calendarTodayKey).trim()
      if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
        return json({ error: 'start_date and end_date must be YYYY-MM-DD' }, 400)
      }
      const result = await rebuildLedgerDaySnapshots(admin, businessId, startDate, endDate)
      return json({ ok: true, ...result, start_date: startDate, end_date: endDate })
    }

    if (action === 'backfill_external') {
      const startDate = String(body.start_date || '').trim()
      const endDate = String(body.end_date || calendarTodayKey).trim()
      const cursorDate = String(body.cursor_date || startDate).trim()
      const maxDays = Number(body.max_days) || 7
      if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
        return json({ error: 'start_date and end_date must be YYYY-MM-DD' }, 400)
      }
      if (!DATE_RE.test(cursorDate)) {
        return json({ error: 'cursor_date must be YYYY-MM-DD' }, 400)
      }

      const result = await backfillExternalSales(
        admin,
        businessId,
        tz,
        startDate,
        endDate,
        { cursorDate, maxDays },
      )
      return json({ ok: result.ok, ...result })
    }

    return json({ error: 'Invalid action' }, 400)
  } catch (error) {
    console.error('[daily-sales-ledger]', error)
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

  throw new Error('Forbidden for this business')
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
