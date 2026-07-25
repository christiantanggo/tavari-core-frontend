import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const OTP_TTL_MINUTES = 10
const GENERIC_REQUEST_MESSAGE = 'If that phone number is on file, a verification code has been sent to the employee email address.'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** HTTP 200 + ok:false so supabase.functions.invoke parses JSON (4xx responses lose body in the client). */
function fail(message: string) {
  return json({ ok: false, error: message })
}

const GENERIC_SIGN_IN_FAILURE = 'We couldn’t complete sign-in. Please try again or request a new code.'

type EmployeeCandidate = {
  employee_id: string
  email: string
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
  employment_status?: string | null
  status?: string | null
  termination_date?: string | null
  business_id: string
  business_name?: string | null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')

    if (action === 'request') {
      return await requestCode(admin, req, body)
    }

    if (action === 'verify') {
      return await verifyCode(admin, body)
    }

    if (action === 'select_profile') {
      return await selectProfile(admin, body)
    }

    return fail('Invalid request.')
  } catch (error) {
    console.error('[employee-portal-otp-action] error', error)
    return fail(GENERIC_SIGN_IN_FAILURE)
  }
})

async function requestCode(admin: ReturnType<typeof createClient>, req: Request, body: Record<string, unknown>) {
  const phone = await canonicalPhoneDigits(admin, body.phone)
  if (phone.length < 10) return json({ ok: false, error: 'Enter a valid phone number.' })

  const candidates = await findCandidates(admin, phone)
  const eligible = candidates.filter(isEmployeePortalEligible)
  const employee = chooseDeliveryEmployee(eligible)
  const deliveryEmails = getUniqueDeliveryEmails(eligible)

  if (candidates.length === 0) {
    return json({ ok: false, error: 'No employee account was found with that phone number. Please check the phone number saved on the employee profile.' })
  }

  if (deliveryEmails.length === 0) {
    return json({ ok: false, error: 'This employee profile has no email address on file. Add an email address before using email code login.' })
  }

  if (!employee) return json({ ok: false, error: 'No eligible employee portal account was found for that phone number.' })

  const recent = await hasRecentCode(admin, employee.employee_id)
  if (recent) {
    return json({ ok: false, error: 'A code was already sent. Please wait a minute before requesting another one.' })
  }

  const code = generateOtpCode()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000).toISOString()

  const { error: insertError } = await admin
    .from('employee_portal_otp')
    .insert({
      employee_id: employee.employee_id,
      business_id: employee.business_id,
      phone_number: phone,
      email: employee.email.trim().toLowerCase(),
      otp_code: code,
      expires_at: expiresAt,
      ip_address: getIpAddress(req),
      user_agent: req.headers.get('user-agent') || null,
    })

  if (insertError) throw insertError

  const sendResults = await Promise.allSettled(deliveryEmails.map((recipient) =>
    sendOtpEmail({
      businessId: recipient.business_id,
      businessName: recipient.business_name || 'Tavari',
      to: recipient.email,
      code,
      employeeName: recipient.employee_name,
    })
  ))
  const successfulSends = sendResults.filter((result) => result.status === 'fulfilled').length
  if (successfulSends === 0) {
    const firstFailure = sendResults.find((result) => result.status === 'rejected')
    throw new Error(firstFailure && 'reason' in firstFailure ? firstFailure.reason?.message || 'Could not send employee verification email' : 'Could not send employee verification email')
  }

  return json({
    ok: true,
    message: GENERIC_REQUEST_MESSAGE,
    masked_email: deliveryEmails.length === 1 ? maskEmail(deliveryEmails[0].email) : `${deliveryEmails.length} emails on file`,
    profile_count: buildProfiles(eligible).length,
    expires_in_minutes: OTP_TTL_MINUTES,
  })
}

async function verifyCode(admin: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const phone = await canonicalPhoneDigits(admin, body.phone)
  const otpDigits = normalizeOtpDigits(body)

  if (phone.length < 10) return fail('Enter a valid phone number.')
  if (!otpDigits) return fail('Enter the 6-digit code from your email.')

  const rawPhoneInput = String(body.phone ?? '').normalize('NFKC')

  let record: Record<string, unknown> | null = null
  const { data: rpcRows, error: rpcErr } = await admin.rpc('employee_portal_fetch_active_otp', {
    p_phone: rawPhoneInput,
    p_otp: otpDigits,
  })

  if (!rpcErr) {
    const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows
    record = (row && typeof row === 'object') ? row as Record<string, unknown> : null
  } else {
    console.warn('[employee-portal-otp-action] otp lookup RPC (fallback to legacy)', rpcErr)
    record = await legacyFetchActiveOtp(admin, phone, otpDigits)
  }

  if (!record) {
    await incrementLatestAttempt(admin, rawPhoneInput, phone)
    return fail('That code is incorrect or expired. Check your email or tap “Resend code”.')
  }

  const candidates = await findCandidates(admin, rawPhoneInput)
  const eligible = candidates.filter(isEmployeePortalEligible)
  const profiles = buildProfiles(eligible)

  if (body.profile_selection === true && profiles.length > 1 && !body.employee_id && !body.business_id) {
    const verifiedAt = new Date().toISOString()
    await admin
      .from('employee_portal_otp')
      .update({ verified_at: verifiedAt })
      .eq('id', record.id)

    return json({
      ok: true,
      selection_required: true,
      verification_id: record.id,
      profiles,
    })
  }

  const employee = eligible.find((candidate) =>
    String(candidate.employee_id) === String(body.employee_id || record.employee_id) &&
    String(candidate.business_id) === String(body.business_id || record.business_id)
  )

  if (!employee) {
    return fail('Your account can’t use the employee portal right now. Contact your manager if you need help.')
  }

  return await createLoginResponse(admin, record, employee, profiles)
}

async function resolvePortalLoginEmail(
  admin: ReturnType<typeof createClient>,
  employee: EmployeeCandidate,
): Promise<string> {
  const profileEmail = String(employee.email || '').trim().toLowerCase()
  if (!profileEmail) {
    throw new Error('Employee profile is missing an email address.')
  }

  const { data: authData, error: authError } = await admin.auth.admin.getUserById(employee.employee_id)
  if (authError || !authData?.user) {
    return profileEmail
  }

  const authEmail = String(authData.user.email || '').trim().toLowerCase()
  if (!authEmail || authEmail === profileEmail) {
    return profileEmail
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(employee.employee_id, {
    email: profileEmail,
    email_confirm: true,
  })

  if (updateError) {
    console.error('[employee-portal-otp-action] auth email sync failed', updateError)
    return authEmail
  }

  return profileEmail
}

async function createLoginResponse(
  admin: ReturnType<typeof createClient>,
  record: Record<string, unknown>,
  employee: EmployeeCandidate,
  profiles: ReturnType<typeof buildProfiles>,
) {
  const loginEmail = await resolvePortalLoginEmail(admin, employee)

  const link = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: loginEmail,
  })

  if (link.error) {
    console.error('[employee-portal-otp-action] generateLink', link.error)
    return fail(
      'We couldn’t start your login from this email. Ask your manager to confirm your profile email in Tavari, then try again.',
    )
  }

  const tokenHash = getTokenHash(link.data)
  if (!tokenHash) {
    console.error('[employee-portal-otp-action] missing token_hash from generateLink')
    return fail(GENERIC_SIGN_IN_FAILURE)
  }

  const verifiedAt = new Date().toISOString()
  const { error: updateError } = await admin
    .from('employee_portal_otp')
    .update({
      is_used: true,
      verified_at: verifiedAt,
    })
    .eq('id', record.id)

  if (updateError) {
    console.error('[employee-portal-otp-action] otp row update', updateError)
    return fail(GENERIC_SIGN_IN_FAILURE)
  }

  return json({
    ok: true,
    email: loginEmail,
    token_hash: tokenHash,
    type: 'magiclink',
    profiles,
    employee: {
      id: employee.employee_id,
      email: loginEmail,
      business_id: employee.business_id,
    },
  })
}

async function selectProfile(admin: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const verificationId = String(body.verification_id || '')
  const employeeId = String(body.employee_id || '')
  const businessId = String(body.business_id || '')

  if (!verificationId || !employeeId || !businessId) {
    return fail('Choose a workplace profile, or go back and enter your code again.')
  }

  const { data: record, error: lookupError } = await admin
    .from('employee_portal_otp')
    .select('*')
    .eq('id', verificationId)
    .eq('is_used', false)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (lookupError) {
    console.error('[employee-portal-otp-action] select lookup', lookupError)
    return fail(GENERIC_SIGN_IN_FAILURE)
  }
  if (!record?.verified_at) return fail('That verification step expired. Go back and request a new code.')

  const candidates = await findCandidates(admin, record.phone_number)
  const eligible = candidates.filter(isEmployeePortalEligible)
  const profiles = buildProfiles(eligible)
  const employee = eligible.find((candidate) =>
    String(candidate.employee_id) === String(employeeId) &&
    String(candidate.business_id) === String(businessId)
  )

  if (!employee) {
    return fail('That workplace profile isn’t available for portal login. Choose another or contact your manager.')
  }

  return await createLoginResponse(admin, record, employee, profiles)
}

async function findCandidates(admin: ReturnType<typeof createClient>, phone: string): Promise<EmployeeCandidate[]> {
  const { data, error } = await admin.rpc('employee_portal_find_employee_by_phone', {
    p_phone: phone,
  })

  if (error) throw error
  return (data || []) as EmployeeCandidate[]
}

function isEmployeePortalEligible(employee: EmployeeCandidate) {
  if (!employee.email || !employee.business_id) return false
  const statuses = [employee.employment_status, employee.status]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)

  if (statuses.includes('inactive')) return false
  if (statuses.includes('terminated') && employee.termination_date) {
    const accessEnd = new Date(`${employee.termination_date}T12:00:00`)
    accessEnd.setDate(accessEnd.getDate() + 30)
    return new Date() <= accessEnd
  }
  if (statuses.includes('terminated')) return false
  return true
}

function chooseDeliveryEmployee(candidates: EmployeeCandidate[]) {
  const byEmployee = new Map<string, EmployeeCandidate[]>()
  for (const candidate of candidates) {
    if (!candidate.employee_id || !candidate.email) continue
    const key = `${candidate.employee_id}:${candidate.email.trim().toLowerCase()}`
    byEmployee.set(key, [...(byEmployee.get(key) || []), candidate])
  }

  const rows = Array.from(byEmployee.values()).map((entries) => entries[0]).filter(Boolean)
  rows.sort((a, b) => {
    const aTerminated = isTerminated(a) ? 1 : 0
    const bTerminated = isTerminated(b) ? 1 : 0
    if (aTerminated !== bTerminated) return aTerminated - bTerminated
    return String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || ''))
  })
  return rows[0] || null
}

function buildProfiles(candidates: EmployeeCandidate[]) {
  const seen = new Set<string>()
  return candidates
    .filter((candidate) => candidate.employee_id && candidate.business_id && candidate.email)
    .map((candidate) => ({
      employee_id: candidate.employee_id,
      business_id: candidate.business_id,
      email: candidate.email.trim().toLowerCase(),
      employee_name: candidate.full_name || [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || candidate.email,
      business_name: candidate.business_name || 'Business',
      employment_status: candidate.employment_status || candidate.status || 'active',
      terminated: isTerminated(candidate),
    }))
    .filter((profile) => {
      const key = `${profile.employee_id}:${profile.business_id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => {
      if (Number(a.terminated) !== Number(b.terminated)) return Number(a.terminated) - Number(b.terminated)
      return `${a.business_name} ${a.employee_name}`.localeCompare(`${b.business_name} ${b.employee_name}`)
    })
}

function getUniqueDeliveryEmails(candidates: EmployeeCandidate[]) {
  const byEmail = new Map<string, {
    email: string
    business_id: string
    business_name: string | null
    employee_name: string
  }>()

  for (const candidate of candidates) {
    const email = String(candidate.email || '').trim().toLowerCase()
    if (!email || byEmail.has(email)) continue
    byEmail.set(email, {
      email,
      business_id: candidate.business_id,
      business_name: candidate.business_name || null,
      employee_name: candidate.full_name || [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || 'there',
    })
  }

  return Array.from(byEmail.values())
}

function isTerminated(employee: EmployeeCandidate) {
  return [employee.employment_status, employee.status]
    .map((value) => String(value || '').trim().toLowerCase())
    .includes('terminated')
}

async function hasRecentCode(admin: ReturnType<typeof createClient>, employeeId: string) {
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString()
  const { data } = await admin
    .from('employee_portal_otp')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('is_used', false)
    .gt('created_at', oneMinuteAgo)
    .limit(1)
    .maybeSingle()

  return Boolean(data?.id)
}

async function incrementLatestAttempt(
  admin: ReturnType<typeof createClient>,
  rawPhone: string,
  canonicalDigits: string,
) {
  const { error } = await admin.rpc('employee_portal_increment_otp_attempt', {
    p_phone: rawPhone.normalize('NFKC'),
  })
  if (!error) return

  console.warn('[employee-portal-otp-action] increment_otp_attempt RPC (legacy)', error)
  const { data } = await admin
    .from('employee_portal_otp')
    .select('id, attempts')
    .eq('phone_number', canonicalDigits)
    .eq('is_used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data?.id) return

  await admin
    .from('employee_portal_otp')
    .update({ attempts: Number(data.attempts || 0) + 1 })
    .eq('id', data.id)
}

async function legacyFetchActiveOtp(
  admin: ReturnType<typeof createClient>,
  canonicalDigits: string,
  otpDigits: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from('employee_portal_otp')
    .select('*')
    .eq('phone_number', canonicalDigits)
    .eq('otp_code', otpDigits)
    .eq('is_used', false)
    .gt('expires_at', new Date().toISOString())
    .lt('attempts', 5)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[employee-portal-otp-action] legacy otp lookup', error)
    return null
  }
  return data && typeof data === 'object' ? data as Record<string, unknown> : null
}

async function canonicalPhoneDigits(admin: ReturnType<typeof createClient>, raw: unknown): Promise<string> {
  const rawStr = String(raw ?? '').normalize('NFKC')
  const { data, error } = await admin.rpc('employee_portal_phone_digits', { p_phone: rawStr })
  if (error) {
    console.warn('[employee-portal-otp-action] employee_portal_phone_digits RPC failed', error)
    return normalizePhoneLegacy(rawStr)
  }
  const digits = String(data ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits : normalizePhoneLegacy(rawStr)
}

function normalizePhoneLegacy(value: string): string {
  const digits = String(value ?? '').normalize('NFKC').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

/** Normalize OTP from JSON (handles missing leading zeros if only 5 digits entered). */
function normalizeOtpDigits(body: Record<string, unknown>): string | null {
  let d = String(body.otp_code ?? body.code ?? '').normalize('NFKC').replace(/\D/g, '')
  if (d.length > 6) d = d.slice(-6)
  if (d.length === 5) d = d.padStart(6, '0')
  if (d.length !== 6) return null
  return d
}

async function sendOtpEmail(input: {
  businessId: string
  businessName: string
  to: string
  code: string
  employeeName: string
}) {
  const businessName = sanitizeDisplayName(input.businessName || 'Tavari')
  const subject = `Your Employee Portal verification code - ${businessName}`
  const text = `Hi ${input.employeeName},

Your Employee Portal verification code is: ${input.code}

This code expires in ${OTP_TTL_MINUTES} minutes.

If you did not request this code, please ignore this email.

Thank you,
${businessName}`

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
      </head>
      <body style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:640px;margin:0 auto;padding:24px;">
        <p>Hi ${escapeHtml(input.employeeName)},</p>
        <p>Your Employee Portal verification code is:</p>
        <div style="font-size:34px;font-weight:800;letter-spacing:8px;text-align:center;padding:18px;margin:20px 0;background:#f3f4f6;border:2px solid #111827;border-radius:10px;">
          ${escapeHtml(input.code)}
        </div>
        <p>This code expires in ${OTP_TTL_MINUTES} minutes.</p>
        <p style="font-size:13px;color:#6b7280;">If you did not request this code, you can ignore this email.</p>
        <p>Thank you,<br>${escapeHtml(businessName)}</p>
      </body>
    </html>
  `

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/mail-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      businessId: input.businessId,
      campaignId: `employee-portal-otp-${Date.now()}`,
      emailType: 'transactional',
      to: input.to,
      fromEmail: 'noreply@tavarios.ca',
      fromName: `${businessName} - Employee Portal`,
      subject,
      html,
      text,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error || `mail-send HTTP ${response.status}`)
  }
}

function generateOtpCode() {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return String(values[0] % 1000000).padStart(6, '0')
}

function getIpAddress(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || null
  return req.headers.get('cf-connecting-ip') || null
}

function getTokenHash(linkData: unknown) {
  const data = linkData as {
    properties?: {
      hashed_token?: string
      action_link?: string
    }
  }
  if (data?.properties?.hashed_token) return data.properties.hashed_token
  const actionLink = data?.properties?.action_link
  if (!actionLink) return null
  try {
    const url = new URL(actionLink)
    return url.searchParams.get('token_hash') || url.hash.match(/token_hash=([^&]+)/)?.[1] || null
  } catch {
    return null
  }
}

function maskEmail(email: string) {
  const [local, domain] = String(email || '').split('@')
  if (!local || !domain) return ''
  const visible = local.length <= 2 ? local[0] : `${local[0]}${local[1]}`
  return `${visible}${'*'.repeat(Math.max(2, local.length - visible.length))}@${domain}`
}

function sanitizeDisplayName(value: string) {
  return Array.from(String(value || '').trim())
    .filter((ch) => {
      const code = ch.charCodeAt(0)
      return code >= 32 && code !== 127 && ch !== '"'
    })
    .join('')
    .replace(/\s+/g, ' ')
    .slice(0, 78) || 'Tavari'
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
