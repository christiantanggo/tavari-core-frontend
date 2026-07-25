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
        .from('hr_incidents')
        .select('*')
        .eq('business_id', business.id)
        .eq('employee_visible', true)
        .or(`reported_by_employee_id.eq.${employee.id},subject_employee_id.eq.${employee.id}`)
        .order('created_at', { ascending: false })

      if (error) throw error
      return json({ ok: true, employee, business, incidents: data || [] })
    }

    if (action === 'submit') {
      const title = stringOrNull(body.title)
      const description = stringOrNull(body.description)
      if (!title) return json({ error: 'Missing incident title' }, 400)
      if (!description) return json({ error: 'Missing incident description' }, 400)

      const { data, error } = await admin
        .from('hr_incidents')
        .insert({
          business_id: business.id,
          title,
          description,
          incident_type: normalizeChoice(body.incident_type, ['general', 'safety', 'injury', 'customer', 'conflict', 'property_damage', 'policy_violation', 'other'], 'general'),
          severity: normalizeChoice(body.severity, ['low', 'normal', 'high', 'critical'], 'normal'),
          status: 'open',
          occurred_at: body.occurred_at || new Date().toISOString(),
          location: stringOrNull(body.location),
          reported_by_employee_id: employee.id,
          employee_visible: true,
          created_by: authData.user.id,
        })
        .select('*')
        .single()

      if (error) throw error
      return json({ ok: true, incident: data })
    }

    return json({ error: 'Invalid action' }, 400)
  } catch (error) {
    console.error('[employee-incidents-action] error', error)
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

function normalizeChoice(value: unknown, allowed: string[], fallback: string) {
  const text = String(value || '').trim()
  return allowed.includes(text) ? text : fallback
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
