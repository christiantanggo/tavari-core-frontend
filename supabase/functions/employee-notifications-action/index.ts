import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type NotificationItem = {
  key: string
  category: string
  title: string
  body: string
  date: string
  priority: 'normal' | 'high'
  path: string
  read?: boolean
  occurrenceId?: string
  reminderActions?: boolean
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
    const preferredBusinessId =
      typeof body.business_id === 'string' && body.business_id.trim() ? body.business_id.trim() : undefined
    const { employee, business } = await resolveEmployee(admin, authData.user.email, preferredBusinessId)
    const businessTimeZone = getBusinessTimezone(business)

    if (action === 'mark_read') {
      const keys = Array.isArray(body.notification_keys)
        ? body.notification_keys.map((key: unknown) => String(key || '').trim()).filter(Boolean)
        : [String(body.notification_key || '').trim()].filter(Boolean)

      if (keys.length === 0) return json({ error: 'Missing notification key' }, 400)
      await markRead(admin, business.id, employee.id, keys)
      return json({ ok: true })
    }

    const notifications = await buildNotifications(admin, business.id, employee.id, businessTimeZone)

    if (action === 'mark_all_read') {
      await markRead(admin, business.id, employee.id, notifications.map((item) => item.key))
      return json({ ok: true })
    }

    if (action !== 'list') return json({ error: 'Invalid action' }, 400)

    const readKeys = await loadReadKeys(admin, business.id, employee.id)
    const items = notifications
      .map((item) => ({ ...item, read: readKeys.has(item.key) }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    return json({
      ok: true,
      business,
      employee,
      notifications: items,
      unreadCount: items.filter((item) => !item.read).length,
    })
  } catch (error) {
    console.error('[employee-notifications-action] error', error)
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})

async function buildNotifications(admin: ReturnType<typeof createClient>, businessId: string, employeeId: string, timeZone: string) {
  const now = new Date()
  const today = getDateInTimeZone(now, timeZone)
  const nextThirty = addDaysToDateString(today, 30)
  const nextTwo = addDaysToDateString(today, 2)
  const items: NotificationItem[] = []

  const { data: shifts } = await admin
    .from('scheduling_shifts')
    .select('id, shift_date, start_time, end_time, position, status, created_at, updated_at, is_published')
    .eq('business_id', businessId)
    .eq('employee_id', employeeId)
    .gte('shift_date', today)
    .lte('shift_date', nextThirty)
    .order('shift_date', { ascending: true })
    .order('start_time', { ascending: true })
    .limit(30)

  ;(shifts || []).filter((shift) => shift.is_published !== false).forEach((shift) => {
    const shiftStart = toDateTime(shift.shift_date, shift.start_time, timeZone)
    const changed = shift.updated_at && shift.created_at && new Date(shift.updated_at).getTime() - new Date(shift.created_at).getTime() > 60_000
    items.push({
      key: `schedule-${changed ? 'changed' : 'posted'}-${shift.id}-${shift.updated_at || shift.created_at || shift.shift_date}`,
      category: 'Schedule',
      title: changed ? 'Schedule changed' : 'Upcoming shift posted',
      body: `${formatDate(shift.shift_date)}${shift.start_time ? ` at ${formatTime(shift.start_time)}` : ''}${shift.position ? ` • ${shift.position}` : ''}`,
      date: shift.updated_at || shift.created_at || `${shift.shift_date}T12:00:00Z`,
      priority: changed ? 'high' : 'normal',
      path: '/portal/schedule',
    })

    if (shift.shift_date <= nextTwo) {
      const hoursUntil = shiftStart ? (shiftStart.getTime() - now.getTime()) / 36e5 : null
      if (hoursUntil !== null && hoursUntil >= 0 && hoursUntil <= 24) {
        items.push({
          key: `shift-reminder-${shift.id}-${shift.shift_date}-${shift.start_time}`,
          category: 'Shift Reminder',
          title: hoursUntil <= 1 ? 'Shift starts soon' : 'Upcoming shift reminder',
          body: `${formatDate(shift.shift_date)} at ${formatTime(shift.start_time)}${shift.position ? ` • ${shift.position}` : ''}`,
          date: new Date(Math.max(now.getTime(), shiftStart.getTime() - 60 * 60 * 1000)).toISOString(),
          priority: hoursUntil <= 1 ? 'high' : 'normal',
          path: '/portal/schedule',
        })
      }
    }
  })

  const { data: businessRuns } = await admin
    .from('hrpayroll_runs')
    .select('id')
    .eq('business_id', businessId)
    .order('pay_date', { ascending: false })

  const runIds = (businessRuns || []).map((run) => run.id)
  if (runIds.length > 0) {
    const { data: payEntries } = await admin
      .from('hrpayroll_entries')
      .select('id, created_at, hrpayroll_runs:hrpayroll_entries_payroll_run_id_fkey(pay_date, pay_period_end)')
      .eq('user_id', employeeId)
      .in('payroll_run_id', runIds)
      .order('created_at', { ascending: false })
      .limit(10)

    ;(payEntries || []).forEach((entry) => {
      const run = entry.hrpayroll_runs || {}
      items.push({
        key: `pay-statement-${entry.id}`,
        category: 'Pay',
        title: 'New pay statement available',
        body: run.pay_period_end ? `Pay period ending ${formatDate(run.pay_period_end)}` : 'A new pay statement is ready to view.',
        date: run.pay_date || run.pay_period_end || entry.created_at,
        priority: 'normal',
        path: `/portal/pay-statements/${entry.id}`,
      })
    })
  }

  const { data: policies } = await admin
    .from('hr_policy_assignments')
    .select('id, assigned_at, due_date, acknowledged, hr_policies!inner(policy_name, requires_acknowledgment)')
    .eq('employee_id', employeeId)
    .eq('acknowledged', false)
    .eq('hr_policies.requires_acknowledgment', true)
    .order('assigned_at', { ascending: false })
    .limit(10)

  ;(policies || []).forEach((assignment) => {
    const overdue = assignment.due_date && new Date(`${assignment.due_date}T23:59:59Z`) < now
    items.push({
      key: `policy-${assignment.id}-${assignment.assigned_at || assignment.due_date}`,
      category: 'Policy',
      title: overdue ? 'Policy acknowledgement overdue' : 'Policy needs acknowledgement',
      body: assignment.hr_policies?.policy_name || 'A policy is waiting for your acknowledgement.',
      date: assignment.assigned_at || assignment.due_date,
      priority: overdue ? 'high' : 'normal',
      path: '/portal/policies',
    })
  })

  const { data: timeOff } = await admin
    .from('scheduling_time_off')
    .select('id, request_type, start_date, end_date, status, created_at, updated_at')
    .eq('business_id', businessId)
    .eq('employee_id', employeeId)
    .in('status', ['approved', 'denied'])
    .order('updated_at', { ascending: false })
    .limit(10)

  ;(timeOff || []).forEach((request) => {
    items.push({
      key: `time-off-${request.id}-${request.status}-${request.updated_at || request.created_at}`,
      category: 'Time Off',
      title: `Time off ${formatStatus(request.status)}`,
      body: `${formatStatus(request.request_type)} • ${formatDate(request.start_date)}${request.end_date && request.end_date !== request.start_date ? ` - ${formatDate(request.end_date)}` : ''}`,
      date: request.updated_at || request.created_at || request.start_date,
      priority: 'normal',
      path: '/portal/time-off',
    })
  })

  const { data: training } = await admin
    .from('hr_training_assignments')
    .select('id, status, due_date, assigned_at, updated_at, hr_training_items!inner(title)')
    .eq('business_id', businessId)
    .eq('employee_id', employeeId)
    .neq('status', 'cancelled')
    .order('updated_at', { ascending: false })
    .limit(10)

  ;(training || []).forEach((assignment) => {
    const complete = assignment.status === 'completed' || assignment.status === 'acknowledged'
    const overdue = !complete && assignment.due_date && new Date(`${assignment.due_date}T23:59:59Z`) < now
    items.push({
      key: `training-${assignment.id}-${assignment.status}-${assignment.updated_at || assignment.assigned_at}`,
      category: 'Training',
      title: complete ? `Training ${formatStatus(assignment.status)}` : overdue ? 'Training overdue' : 'Training assigned',
      body: `${assignment.hr_training_items?.title || 'Assigned training'}${assignment.due_date ? ` • Due ${formatDate(assignment.due_date)}` : ''}`,
      date: assignment.updated_at || assignment.assigned_at || assignment.due_date,
      priority: overdue ? 'high' : 'normal',
      path: '/portal/training',
    })
  })

  const { data: acknowledgements } = await admin
    .from('hr_employee_acknowledgements')
    .select('id, item_type, title, body, severity, due_date, acknowledged_at, created_at, updated_at')
    .eq('business_id', businessId)
    .eq('employee_id', employeeId)
    .is('cancelled_at', null)
    .order('created_at', { ascending: false })
    .limit(10)

  ;(acknowledgements || []).forEach((item) => {
    const acknowledged = Boolean(item.acknowledged_at)
    const overdue = !acknowledged && item.due_date && new Date(`${item.due_date}T23:59:59Z`) < now
    items.push({
      key: `acknowledgement-${item.id}-${item.acknowledged_at || item.updated_at || item.created_at}`,
      category: 'Acknowledgement',
      title: acknowledged ? 'Acknowledgement completed' : overdue ? 'Acknowledgement overdue' : 'Acknowledgement required',
      body: `${formatStatus(item.item_type)} • ${item.title}${item.due_date ? ` • Due ${formatDate(item.due_date)}` : ''}`,
      date: item.acknowledged_at || item.updated_at || item.created_at || item.due_date,
      priority: overdue || item.severity === 'critical' ? 'high' : 'normal',
      path: '/portal/acknowledgements',
    })
  })

  const { data: incidents } = await admin
    .from('hr_incidents')
    .select('id, title, incident_type, severity, status, occurred_at, created_at, updated_at, reported_by_employee_id, subject_employee_id')
    .eq('business_id', businessId)
    .eq('employee_visible', true)
    .or(`reported_by_employee_id.eq.${employeeId},subject_employee_id.eq.${employeeId}`)
    .order('updated_at', { ascending: false })
    .limit(10)

  ;(incidents || []).forEach((incident) => {
    items.push({
      key: `incident-${incident.id}-${incident.status}-${incident.updated_at || incident.created_at}`,
      category: 'Incident',
      title: incident.status === 'open' ? 'Incident submitted' : `Incident ${formatStatus(incident.status)}`,
      body: `${formatStatus(incident.incident_type)} • ${incident.title}`,
      date: incident.updated_at || incident.created_at || incident.occurred_at,
      priority: incident.severity === 'critical' ? 'high' : 'normal',
      path: '/portal/incidents',
    })
  })

  const { data: staffUpdates } = await admin
    .from('hr_employee_updates')
    .select('id, update_type, title, body, priority, due_date, requires_acknowledgement, acknowledged_at, created_at, updated_at')
    .eq('business_id', businessId)
    .eq('employee_id', employeeId)
    .is('cancelled_at', null)
    .order('created_at', { ascending: false })
    .limit(10)

  ;(staffUpdates || []).forEach((item) => {
    const acknowledged = Boolean(item.acknowledged_at)
    const overdue = item.requires_acknowledgement && !acknowledged && item.due_date && new Date(`${item.due_date}T23:59:59Z`) < now
    items.push({
      key: `staff-update-${item.id}-${item.acknowledged_at || item.updated_at || item.created_at}`,
      category: 'Staff Update',
      title: item.requires_acknowledgement && !acknowledged ? 'Staff update needs acknowledgement' : `${formatStatus(item.update_type)} from your manager`,
      body: `${item.title}${item.due_date ? ` • Due ${formatDate(item.due_date)}` : ''}`,
      date: item.acknowledged_at || item.updated_at || item.created_at || item.due_date,
      priority: overdue || item.priority === 'critical' || item.priority === 'important' ? 'high' : 'normal',
      path: '/portal/staff-updates',
    })
  })

  const { data: reminderRecipients } = await admin
    .from('tavari_reminder_staff_recipients')
    .select('reminder_id')
    .eq('business_id', businessId)
    .eq('user_id', employeeId)

  const reminderIds = (reminderRecipients || []).map((row) => row.reminder_id).filter(Boolean)
  if (reminderIds.length > 0) {
    const { data: reminderOccurrences } = await admin
      .from('tavari_reminder_occurrences')
      .select('id, sent_at, reminder_id, tavari_reminders(title, body)')
      .eq('business_id', businessId)
      .in('reminder_id', reminderIds)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(20)

    ;(reminderOccurrences || []).forEach((occ) => {
      const reminder = Array.isArray(occ.tavari_reminders) ? occ.tavari_reminders[0] : occ.tavari_reminders
      items.push({
        key: `reminder-${occ.id}`,
        category: 'Reminder',
        title: reminder?.title || 'Reminder',
        body: reminder?.body || '',
        date: occ.sent_at || now.toISOString(),
        priority: 'normal',
        path: '/portal/notifications',
        occurrenceId: occ.id,
        reminderActions: true,
      })
    })
  }

  return items.filter((item) => item.date).slice(0, 80)
}

async function loadReadKeys(admin: ReturnType<typeof createClient>, businessId: string, employeeId: string) {
  const { data } = await admin
    .from('employee_notification_reads')
    .select('notification_key')
    .eq('business_id', businessId)
    .eq('employee_id', employeeId)

  return new Set((data || []).map((row) => row.notification_key))
}

async function markRead(admin: ReturnType<typeof createClient>, businessId: string, employeeId: string, keys: string[]) {
  if (keys.length === 0) return
  const readAt = new Date().toISOString()
  const rows = Array.from(new Set(keys)).map((key) => ({
    business_id: businessId,
    employee_id: employeeId,
    notification_key: key,
    read_at: readAt,
  }))

  const { error } = await admin
    .from('employee_notification_reads')
    .upsert(rows, { onConflict: 'business_id,employee_id,notification_key' })

  if (error) throw error
}

async function resolveEmployee(
  admin: ReturnType<typeof createClient>,
  email: string,
  preferredBusinessId?: string,
) {
  const normalizedEmail = email.trim()
  const { data: employeeRows, error: employeeError } = await admin
    .from('users')
    .select('id, email, full_name')
    .ilike('email', normalizedEmail)
    .limit(1)

  const employee = employeeRows?.[0]
  if (employeeError || !employee?.id) throw new Error('Employee profile not found')

  if (preferredBusinessId) {
    const { data: preferredRow } = await admin
      .from('business_users')
      .select('business_id, businesses:business_id(id, name, timezone)')
      .eq('user_id', employee.id)
      .eq('business_id', preferredBusinessId)
      .maybeSingle()

    if (preferredRow?.business_id) {
      return { employee, business: preferredRow.businesses || { id: preferredRow.business_id } }
    }
  }

  const { data: businessUser, error: businessUserError } = await admin
    .from('business_users')
    .select('business_id, businesses:business_id(id, name, timezone)')
    .eq('user_id', employee.id)
    .limit(1)
    .maybeSingle()

  if (businessUserError || !businessUser?.business_id) throw new Error('Employee is not associated with a business')
  return { employee, business: businessUser.businesses || { id: businessUser.business_id } }
}

function toDateTime(date: string, time: string | undefined, timeZone: string) {
  if (!date || !time) return null
  return zonedDateTimeToUtc(date, time, timeZone)
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

function zonedDateTimeToUtc(dateValue: string, timeValue: string, timeZone: string) {
  const [year, month, day] = dateValue.split('-').map(Number)
  const [hour = 0, minute = 0, second = 0] = timeValue.split(':').map(Number)
  const targetTime = Date.UTC(year, month - 1, day, hour, minute, second || 0)
  let candidate = new Date(targetTime)

  for (let i = 0; i < 3; i += 1) {
    const zonedParts = getZonedParts(candidate, timeZone)
    const zonedAsUtc = Date.UTC(
      zonedParts.year,
      zonedParts.month - 1,
      zonedParts.day,
      zonedParts.hour,
      zonedParts.minute,
      zonedParts.second,
    )
    candidate = new Date(candidate.getTime() + (targetTime - zonedAsUtc))
  }

  return candidate
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

function addDaysToDateString(dateValue: string, days: number) {
  const [year, month, day] = dateValue.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0))
  return date.toISOString().slice(0, 10)
}

function formatDate(value?: string) {
  if (!value) return ''
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(value?: string) {
  if (!value) return ''
  const [hour, minute] = value.split(':')
  const date = new Date()
  date.setHours(Number(hour), Number(minute), 0, 0)
  return date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
}

function formatStatus(value?: string) {
  return String(value || '').replace(/_/g, ' ')
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
