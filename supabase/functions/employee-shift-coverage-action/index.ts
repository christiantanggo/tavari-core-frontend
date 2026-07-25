import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    const token = authHeader.replace('Bearer ', '')
    const { data: authData, error: authError } = await admin.auth.getUser(token)
    if (authError || !authData.user?.email) return json({ error: 'Invalid user token' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = String(body.action || 'list')
    const preferredBusinessId = body.business_id != null && body.business_id !== ''
      ? String(body.business_id)
      : null
    const { employee, business } = await resolveEmployee(admin, authData.user.email, preferredBusinessId)
    const businessTimeZone = getBusinessTimezone(business)

    if (action === 'list') {
      const requesterIds = buildEmployeeIdFilter(employee.id, authData.user.id)
      const [shiftResult, requestResult] = await Promise.all([
        admin
          .from('scheduling_shifts')
          .select('id, business_id, employee_id, shift_date, start_time, end_time, status, position, notes, is_published')
          .eq('business_id', business.id)
          .in('employee_id', requesterIds)
          .gte('shift_date', getDateInTimeZone(new Date(), businessTimeZone))
          .order('shift_date', { ascending: true })
          .order('start_time', { ascending: true })
          .limit(30),
        admin
          .from('scheduling_shift_coverage_requests')
          .select('*, scheduling_shifts!scheduling_shift_coverage_requests_shift_id_fkey(id, shift_date, start_time, end_time, position)')
          .eq('business_id', business.id)
          .in('requester_employee_id', requesterIds)
          .order('created_at', { ascending: false }),
      ])

      if (shiftResult.error) throw shiftResult.error
      if (requestResult.error) throw requestResult.error

      return json({
        ok: true,
        employee,
        business,
        shifts: (shiftResult.data || []).filter((shift) => shift.is_published !== false),
        requests: requestResult.data || [],
      })
    }

    if (action === 'submit') {
      const shiftId = String(body.shift_id || '')
      const requestType = String(body.request_type || 'coverage')
      if (!shiftId) return json({ error: 'Missing shift_id' }, 400)
      if (!['coverage', 'swap'].includes(requestType)) return json({ error: 'Invalid request type' }, 400)

      const requesterIds = buildEmployeeIdFilter(employee.id, authData.user.id)
      const { data: shift, error: shiftError } = await admin
        .from('scheduling_shifts')
        .select('id, business_id, employee_id, shift_date, start_time, end_time, position, is_published')
        .eq('id', shiftId)
        .eq('business_id', business.id)
        .in('employee_id', requesterIds)
        .maybeSingle()

      if (shiftError) throw shiftError
      if (!shift || shift.is_published === false) return json({ error: 'Shift not found' }, 404)

      const requesterForRow = String(shift.employee_id)
      const offeredShiftId = body.offered_shift_id ? String(body.offered_shift_id) : null
      const { data: request, error } = await admin
        .from('scheduling_shift_coverage_requests')
        .insert({
          business_id: business.id,
          shift_id: shift.id,
          requester_employee_id: requesterForRow,
          request_type: requestType,
          offered_shift_id: offeredShiftId,
          reason: stringOrNull(body.reason),
          requested_by: authData.user.id,
          status: 'pending',
        })
        .select('*')
        .single()

      if (error) throw error

      await sendSchedulingNotification(
        admin,
        business.id,
        { ...employee, id: requesterForRow },
        request,
        shift,
        'shift_coverage_requested',
      )
      return json({ ok: true, request })
    }

    if (action === 'cancel') {
      const requesterIds = buildEmployeeIdFilter(employee.id, authData.user.id)
      const requestId = String(body.request_id || '')
      if (!requestId) return json({ error: 'Missing request_id' }, 400)

      const { data, error } = await admin
        .from('scheduling_shift_coverage_requests')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('business_id', business.id)
        .in('requester_employee_id', requesterIds)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle()

      if (error) throw error
      if (!data) return json({ error: 'Pending request not found' }, 404)
      return json({ ok: true, request: data })
    }

    return json({ error: 'Invalid action' }, 400)
  } catch (error) {
    console.error('[employee-shift-coverage-action] error', error)
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})

function buildEmployeeIdFilter(publicUserId: string, authUserId: string) {
  return [...new Set([publicUserId, authUserId].filter(Boolean))]
}

/** Align with employee portal: prefer selected business; otherwise newest business_users row. */
async function resolveEmployee(
  admin: ReturnType<typeof createClient>,
  email: string,
  preferredBusinessId: string | null,
) {
  const normalized = email.toLowerCase().trim()
  const { data: employee, error: employeeError } = await admin
    .from('users')
    .select('id, email, full_name, first_name, last_name')
    .eq('email', normalized)
    .maybeSingle()

  if (employeeError || !employee?.id) throw new Error('Employee profile not found')

  const { data: rows, error: businessUserError } = await admin
    .from('business_users')
    .select('business_id, created_at, businesses:business_id(id, name, timezone)')
    .eq('user_id', employee.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (businessUserError) throw businessUserError
  if (!rows?.length) throw new Error('Employee is not associated with a business')

  let chosen = rows[0]
  if (preferredBusinessId) {
    const match = rows.find((r) => String(r.business_id) === String(preferredBusinessId))
    if (match) chosen = match
  }

  return {
    employee,
    business: chosen.businesses || { id: chosen.business_id },
  }
}

async function sendSchedulingNotification(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  employee: Record<string, unknown>,
  request: Record<string, unknown>,
  shift: Record<string, unknown>,
  eventKey: string,
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
        employeeId: employee.id,
        context: {
          employeeName: employee.full_name || employee.email,
          requestId: request.id,
          requestType: request.request_type,
          shiftId: shift.id,
          shiftDate: shift.shift_date,
          startTime: shift.start_time,
          endTime: shift.end_time,
          position: shift.position,
          reason: request.reason,
          status: request.status,
        },
      }),
    })
  } catch (error) {
    console.warn('[employee-shift-coverage-action] notification failed', error)
  }
}

function stringOrNull(value: unknown) {
  const text = String(value || '').trim()
  return text || null
}

function getBusinessTimezone(value: unknown) {
  const business = Array.isArray(value) ? value[0] : value
  if (business && typeof business === 'object' && 'timezone' in business) {
    const timeZone = String((business as { timezone?: unknown }).timezone || '')
    if (timeZone) return timeZone
  }
  return 'America/Toronto'
}

function getDateInTimeZone(date: Date, timeZone = 'America/Toronto') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
