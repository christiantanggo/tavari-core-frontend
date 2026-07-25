import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const REQUEST_TYPES = new Set(['vacation', 'sick', 'personal', 'bereavement', 'jury_duty', 'other'])

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
    const { employee, business } = await resolveEmployee(admin, authData.user.email)

    if (action === 'list') {
      const { data, error } = await admin
        .from('scheduling_time_off')
        .select('*')
        .eq('business_id', business.id)
        .eq('employee_id', employee.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return json({ ok: true, employee, business, requests: data || [] })
    }

    if (action === 'submit') {
      const payload = normalizeTimeOffPayload(body, business.id, employee.id, authData.user.id)
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      })

      const { data: elig, error: eligErr } = await userClient.rpc('scheduling_check_time_off_eligible', {
        p_business_id: business.id,
        p_employee_id: employee.id,
        p_start_date: payload.start_date,
        p_end_date: payload.end_date,
        p_exclude_request_id: null,
      })
      if (eligErr) throw eligErr
      if (elig && elig.ok === false) {
        return json({ error: String(elig.message || 'Time off request is not allowed') }, 400)
      }

      const { data, error } = await userClient
        .from('scheduling_time_off')
        .insert(payload)
        .select('*')
        .single()

      if (error) throw error

      await sendSchedulingNotification(admin, business.id, employee, data, 'time_off_requested')
      return json({ ok: true, request: data })
    }

    if (action === 'cancel') {
      const requestId = String(body.request_id || '')
      if (!requestId) return json({ error: 'Missing request_id' }, 400)

      const { data, error } = await admin
        .from('scheduling_time_off')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('business_id', business.id)
        .eq('employee_id', employee.id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle()

      if (error) throw error
      if (!data) return json({ error: 'Pending time-off request not found' }, 404)
      return json({ ok: true, request: data })
    }

    return json({ error: 'Invalid action' }, 400)
  } catch (error) {
    console.error('[employee-time-off-action] error', error)
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})

async function resolveEmployee(admin: ReturnType<typeof createClient>, email: string) {
  const { data: employee, error: employeeError } = await admin
    .from('users')
    .select('id, email, full_name, first_name, last_name')
    .eq('email', email)
    .maybeSingle()

  if (employeeError || !employee?.id) throw new Error('Employee profile not found')

  const { data: businessUser, error: businessUserError } = await admin
    .from('business_users')
    .select('business_id, businesses:business_id(id, name, timezone)')
    .eq('user_id', employee.id)
    .limit(1)
    .maybeSingle()

  if (businessUserError || !businessUser?.business_id) throw new Error('Employee is not associated with a business')

  return {
    employee,
    business: businessUser.businesses || { id: businessUser.business_id },
  }
}

function normalizeTimeOffPayload(body: Record<string, unknown>, businessId: string, employeeId: string, authUserId: string) {
  const requestType = String(body.request_type || 'vacation')
  if (!REQUEST_TYPES.has(requestType)) throw new Error('Invalid request type')

  const startDate = stringOrNull(body.start_date)
  const endDate = stringOrNull(body.end_date)
  if (!startDate || !endDate) throw new Error('Start and end dates are required')
  if (new Date(`${endDate}T12:00:00`) < new Date(`${startDate}T12:00:00`)) {
    throw new Error('End date must be on or after start date')
  }

  const isPartialDay = body.is_partial_day === true
  const startTime = isPartialDay ? normalizeTime(String(body.start_time || '')) : null
  const endTime = isPartialDay ? normalizeTime(String(body.end_time || '')) : null
  const totalHours = isPartialDay && startTime && endTime ? calculateHours(startTime, endTime) : null

  if (isPartialDay && (!totalHours || totalHours <= 0)) throw new Error('Partial-day end time must be after start time')

  return {
    business_id: businessId,
    employee_id: employeeId,
    request_type: requestType,
    start_date: startDate,
    end_date: endDate,
    start_time: startTime,
    end_time: endTime,
    total_hours: totalHours,
    status: 'pending',
    requested_by: authUserId,
    notes: stringOrNull(body.notes),
    is_partial_day: isPartialDay,
  }
}

function normalizeTime(value: string) {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error('Invalid time')
  return value.length === 5 ? `${value}:00` : value
}

function calculateHours(startTime: string, endTime: string) {
  const [startHour, startMinute] = startTime.split(':').map(Number)
  const [endHour, endMinute] = endTime.split(':').map(Number)
  const start = startHour * 60 + startMinute
  const end = endHour * 60 + endMinute
  return Number(((end - start) / 60).toFixed(2))
}

function stringOrNull(value: unknown) {
  const text = String(value || '').trim()
  return text || null
}

async function sendSchedulingNotification(admin: ReturnType<typeof createClient>, businessId: string, employee: Record<string, unknown>, request: Record<string, unknown>, eventKey: string) {
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
          requestId: request.id,
          employeeName: employee.full_name || employee.email,
          requestType: request.request_type,
          startDate: request.start_date,
          endDate: request.end_date,
          startTime: request.start_time,
          endTime: request.end_time,
          totalHours: request.total_hours,
          isPartialDay: request.is_partial_day,
          status: request.status,
          notes: request.notes,
          denialReason: request.denial_reason,
        },
      }),
    })
  } catch (error) {
    console.warn('[employee-time-off-action] notification failed', error)
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
