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
        .from('hr_employee_acknowledgements')
        .select('*')
        .eq('business_id', business.id)
        .eq('employee_id', employee.id)
        .is('cancelled_at', null)
        .order('acknowledged_at', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: false })

      if (error) throw error
      return json({ ok: true, employee, business, acknowledgements: data || [] })
    }

    if (action === 'acknowledge') {
      const acknowledgementId = String(body.acknowledgement_id || '')
      if (!acknowledgementId) return json({ error: 'Missing acknowledgement_id' }, 400)

      const { data: existing, error: lookupError } = await admin
        .from('hr_employee_acknowledgements')
        .select('id, business_id, employee_id, title, acknowledged_at, requires_acknowledgement, cancelled_at')
        .eq('id', acknowledgementId)
        .eq('business_id', business.id)
        .eq('employee_id', employee.id)
        .maybeSingle()

      if (lookupError) throw lookupError
      if (!existing || existing.cancelled_at) return json({ error: 'Acknowledgement not found' }, 404)
      if (!existing.requires_acknowledgement) return json({ error: 'This item does not require acknowledgement' }, 400)
      if (existing.acknowledged_at) return json({ ok: true, acknowledgement: existing })

      const acknowledgedAt = new Date().toISOString()
      const { data: updated, error: updateError } = await admin
        .from('hr_employee_acknowledgements')
        .update({
          acknowledged_at: acknowledgedAt,
          acknowledged_by: employee.id,
          employee_note: stringOrNull(body.employee_note),
          updated_at: acknowledgedAt,
        })
        .eq('id', existing.id)
        .select('*')
        .single()

      if (updateError) throw updateError
      return json({ ok: true, acknowledgement: updated })
    }

    return json({ error: 'Invalid action' }, 400)
  } catch (error) {
    console.error('[employee-acknowledgements-action] error', error)
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
  return { employee, business: businessUser.businesses || { id: businessUser.business_id } }
}

function stringOrNull(value: unknown) {
  const text = String(value || '').trim()
  return text || null
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
