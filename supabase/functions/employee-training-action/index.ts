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
        .from('hr_training_assignments')
        .select(`
          id,
          business_id,
          training_item_id,
          employee_id,
          status,
          due_date,
          assigned_at,
          started_at,
          completed_at,
          acknowledged_at,
          employee_notes,
          manager_notes,
          updated_at,
          hr_training_items!hr_training_assignments_training_item_id_fkey (
            id,
            title,
            description,
            content,
            resource_url,
            sections,
            steps,
            quiz,
            requires_acknowledgement,
            is_active
          )
        `)
        .eq('business_id', business.id)
        .eq('employee_id', employee.id)
        .neq('status', 'cancelled')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('assigned_at', { ascending: false })

      if (error) throw error
      return json({ ok: true, employee, business, assignments: data || [] })
    }

    if (action === 'start' || action === 'complete' || action === 'acknowledge') {
      const assignmentId = String(body.assignment_id || '')
      if (!assignmentId) return json({ error: 'Missing assignment_id' }, 400)

      const { data: assignment, error: lookupError } = await admin
        .from('hr_training_assignments')
        .select('id, business_id, employee_id, status, started_at, completed_at, hr_training_items!inner(requires_acknowledgement, quiz)')
        .eq('id', assignmentId)
        .eq('business_id', business.id)
        .eq('employee_id', employee.id)
        .maybeSingle()

      if (lookupError) throw lookupError
      if (!assignment) return json({ error: 'Training assignment not found' }, 404)
      if (assignment.status === 'cancelled') return json({ error: 'Training assignment is cancelled' }, 400)

      const now = new Date().toISOString()
      const updatePayload: Record<string, unknown> = { updated_at: now }

      if (action === 'start') {
        updatePayload.status = assignment.status === 'assigned' ? 'in_progress' : assignment.status
        updatePayload.started_at = assignment.started_at || now
      }

      if (action === 'complete') {
        const requiresAck = Boolean(assignment.hr_training_items?.requires_acknowledgement)
        const quizResult = evaluateQuiz(assignment.hr_training_items?.quiz, body.quiz_answers)
        if (quizResult.required && !quizResult.passed) {
          return json({
            error: `Quiz score ${quizResult.score}% is below the required ${quizResult.passing_score}%`,
            quiz_score: quizResult.score,
            quiz_passed: false,
          }, 400)
        }
        updatePayload.status = requiresAck ? 'completed' : 'acknowledged'
        updatePayload.started_at = assignment.started_at || now
        updatePayload.completed_at = now
        if (!requiresAck) updatePayload.acknowledged_at = now
        updatePayload.employee_notes = stringOrNull(body.employee_notes)
        updatePayload.quiz_answers = body.quiz_answers || {}
        updatePayload.quiz_score = quizResult.required ? quizResult.score : null
        updatePayload.quiz_passed = quizResult.required ? quizResult.passed : null
      }

      if (action === 'acknowledge') {
        updatePayload.status = 'acknowledged'
        updatePayload.started_at = assignment.started_at || now
        updatePayload.completed_at = assignment.completed_at || now
        updatePayload.acknowledged_at = now
        updatePayload.employee_notes = stringOrNull(body.employee_notes)
      }

      const { data: updated, error: updateError } = await admin
        .from('hr_training_assignments')
        .update(updatePayload)
        .eq('id', assignment.id)
        .select(`
          id,
          status,
          due_date,
          assigned_at,
          started_at,
          completed_at,
          acknowledged_at,
          employee_notes,
          manager_notes,
          updated_at,
          hr_training_items!hr_training_assignments_training_item_id_fkey (
            id,
            title,
            description,
            content,
            resource_url,
            sections,
            steps,
            quiz,
            requires_acknowledgement
          )
        `)
        .single()

      if (updateError) throw updateError
      return json({ ok: true, assignment: updated })
    }

    return json({ error: 'Invalid action' }, 400)
  } catch (error) {
    console.error('[employee-training-action] error', error)
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

function evaluateQuiz(quiz: unknown, answers: unknown) {
  const quizObj = (quiz && typeof quiz === 'object') ? quiz as Record<string, unknown> : {}
  const enabled = quizObj.enabled === true
  const questions = Array.isArray(quizObj.questions) ? quizObj.questions as Array<Record<string, unknown>> : []
  if (!enabled || questions.length === 0) {
    return { required: false, score: null, passed: true, passing_score: null }
  }

  const answerMap = (answers && typeof answers === 'object') ? answers as Record<string, unknown> : {}
  const graded = questions.filter((question) => String(question.correct_answer || '').trim())
  if (graded.length === 0) {
    return { required: false, score: null, passed: true, passing_score: null }
  }

  const correct = graded.filter((question) => {
    const expected = normalizeAnswer(question.correct_answer)
    const actual = normalizeAnswer(answerMap[String(question.id || '')])
    return expected && actual && expected === actual
  }).length
  const score = Math.round((correct / graded.length) * 100)
  const passingScore = Number(quizObj.passing_score || 80)
  return {
    required: true,
    score,
    passed: score >= passingScore,
    passing_score: passingScore,
  }
}

function normalizeAnswer(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
