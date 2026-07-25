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

    const { employee, business } = await resolveEmployee(admin, authData.user.email)

    if (action === 'list') {
      const { data, error } = await admin
        .from('scheduling_availability')
        .select('*')
        .eq('business_id', business.id)
        .eq('employee_id', employee.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      return json({ ok: true, employee, business, availability: data || [] })
    }

    if (action === 'submit') {
      const payload = normalizeAvailabilityPayload(body, business.id, employee.id, authData.user.id)
      const { data, error } = await admin
        .from('scheduling_availability')
        .insert(payload)
        .select('*')
        .single()

      if (error) throw error

      await sendSchedulingNotification(admin, business.id, employee.id, data)
      return json({ ok: true, availability: data })
    }

    if (action === 'cancel') {
      const availabilityId = String(body.availability_id || '')
      if (!availabilityId) return json({ error: 'Missing availability_id' }, 400)

      const { data, error } = await admin
        .from('scheduling_availability')
        .update({ status: 'cancelled' })
        .eq('id', availabilityId)
        .eq('business_id', business.id)
        .eq('employee_id', employee.id)
        .select('*')
        .maybeSingle()

      if (error) throw error
      if (!data) return json({ error: 'Availability request not found' }, 404)
      return json({ ok: true, availability: data })
    }

    return json({ error: 'Invalid action' }, 400)
  } catch (error) {
    console.error('[employee-availability-action] error', error)
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

function normalizeAvailabilityPayload(body: Record<string, unknown>, businessId: string, employeeId: string, authUserId: string) {
  const dayOfWeek = Number(body.day_of_week)
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) throw new Error('Invalid day of week')

  const allDay = body.all_day !== false
  const startTime = allDay ? '00:00:00' : normalizeTime(String(body.start_time || ''))
  const endTime = allDay ? '23:59:00' : normalizeTime(String(body.end_time || ''))

  if (!allDay && startTime >= endTime) throw new Error('End time must be after start time')

  return {
    business_id: businessId,
    employee_id: employeeId,
    day_of_week: dayOfWeek,
    is_available: body.is_available !== false,
    all_day: allDay,
    start_time: startTime,
    end_time: endTime,
    effective_date: stringOrNull(body.effective_date),
    expiry_date: stringOrNull(body.expiry_date),
    notes: stringOrNull(body.notes),
    requested_by: authUserId,
    status: 'pending',
  }
}

function normalizeTime(value: string) {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error('Invalid time')
  return value.length === 5 ? `${value}:00` : value
}

function stringOrNull(value: unknown) {
  const text = String(value || '').trim()
  return text || null
}

async function sendSchedulingNotification(admin: ReturnType<typeof createClient>, businessId: string, employeeId: string, availability: Record<string, unknown>) {
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
        eventKey: 'availability_submitted',
        employeeId,
        context: { availability },
      }),
    })
  } catch (error) {
    console.warn('[employee-availability-action] notification failed', error)
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
