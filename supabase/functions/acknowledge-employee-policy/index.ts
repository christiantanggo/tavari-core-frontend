import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization header' }, 401)
    }

    const token = authHeader.replace('Bearer ', '')
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !authData.user?.email) {
      return jsonResponse({ error: 'Invalid user token' }, 401)
    }

    const { assignment_id } = await req.json()
    if (!assignment_id) {
      return jsonResponse({ error: 'Missing assignment_id' }, 400)
    }

    const authUser = authData.user
    const { data: publicUser } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', authUser.email)
      .maybeSingle()

    const allowedEmployeeIds = new Set(
      [authUser.id, publicUser?.id].filter((id): id is string => Boolean(id))
    )

    const { data: assignment, error: assignmentError } = await supabaseAdmin
      .from('hr_policy_assignments')
      .select(`
        id,
        employee_id,
        employee_email,
        acknowledged,
        acknowledged_at,
        policy_id,
        hr_policies!inner (
          id,
          requires_acknowledgment
        )
      `)
      .eq('id', assignment_id)
      .maybeSingle()

    if (assignmentError) {
      console.error('[acknowledge-employee-policy] Assignment lookup failed:', assignmentError)
      return jsonResponse({ error: 'Failed to load policy assignment' }, 500)
    }

    if (!assignment) {
      return jsonResponse({ error: 'Policy assignment not found' }, 404)
    }

    const emailMatches = assignment.employee_email?.toLowerCase() === authUser.email.toLowerCase()
    if (!allowedEmployeeIds.has(assignment.employee_id) && !emailMatches) {
      return jsonResponse({ error: 'You are not allowed to acknowledge this policy' }, 403)
    }

    const policy = Array.isArray(assignment.hr_policies)
      ? assignment.hr_policies[0]
      : assignment.hr_policies

    if (policy?.requires_acknowledgment === false) {
      return jsonResponse({ error: 'This policy does not require acknowledgment' }, 400)
    }

    const acknowledgedAt = new Date().toISOString()
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('hr_policy_assignments')
      .update({
        acknowledged: true,
        acknowledged_at: acknowledgedAt,
      })
      .eq('id', assignment.id)
      .select('id, acknowledged, acknowledged_at')
      .single()

    if (updateError) {
      console.error('[acknowledge-employee-policy] Assignment update failed:', updateError)
      return jsonResponse({ error: 'Failed to acknowledge policy' }, 500)
    }

    return jsonResponse({ assignment: updated })
  } catch (error) {
    console.error('[acknowledge-employee-policy] Unexpected error:', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}
