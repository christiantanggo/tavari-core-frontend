import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type LocationPayload = {
  latitude?: number
  longitude?: number
  accuracy?: number
}

type PhotoAttachmentResult = {
  ok: boolean
  skipped?: boolean
  error?: string
  publicUrl?: string
}

function normalizeClockPhotoBase64(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const cleaned = trimmed.replace(/^data:image\/\w+;base64,/i, '').replace(/\s/g, '')
  if (cleaned.length < 80) return null
  if (cleaned.length > 7_500_000) return null
  return cleaned
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function attachClockPhotoWithServiceRole(
  admin: ReturnType<typeof createClient>,
  timeClockId: string,
  employeeId: string,
  column:
    | 'photo_verification_url'
    | 'clock_out_photo_url'
    | 'clock_in_environment_photo_url'
    | 'clock_out_environment_photo_url',
  rawPhoto: unknown,
): Promise<PhotoAttachmentResult> {
  const base64 = normalizeClockPhotoBase64(rawPhoto)
  if (!base64) return { ok: true, skipped: true }

  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(base64)
  } catch {
    console.warn('[employee-time-clock-action] invalid clock photo base64')
    return { ok: false, error: 'Invalid photo data' }
  }

  if (bytes.byteLength < 200 || bytes.byteLength > 6_000_000) {
    return { ok: false, error: 'Photo size is not valid' }
  }

  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
  const fileName = `employee-app/${employeeId}/${id}.jpg`

  const { error: uploadError } = await admin.storage.from('time-clock-photos').upload(fileName, bytes, {
    contentType: 'image/jpeg',
    upsert: false,
  })

  if (uploadError) {
    console.error('[employee-time-clock-action] photo upload failed', uploadError)
    return { ok: false, error: uploadError.message || 'Photo upload failed' }
  }

  const { data: urlData } = admin.storage.from('time-clock-photos').getPublicUrl(fileName)
  const publicUrl = urlData?.publicUrl
  if (!publicUrl) {
    return { ok: false, error: 'Could not resolve photo URL' }
  }

  const { error: updateError } = await admin
    .from('scheduling_time_clocks')
    .update({ [column]: publicUrl })
    .eq('id', timeClockId)
    .eq('employee_id', employeeId)

  if (updateError) {
    console.error('[employee-time-clock-action] photo column update failed', updateError)
    return { ok: false, error: updateError.message || 'Could not save photo on time card' }
  }

  return { ok: true, publicUrl }
}

async function attachBreakPhotoWithServiceRole(
  admin: ReturnType<typeof createClient>,
  breakId: string,
  employeeId: string,
  column: 'photo_url_start' | 'photo_url_end',
  rawPhoto: unknown,
): Promise<PhotoAttachmentResult> {
  const base64 = normalizeClockPhotoBase64(rawPhoto)
  if (!base64) return { ok: true, skipped: true }

  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(base64)
  } catch {
    console.warn('[employee-time-clock-action] invalid break photo base64')
    return { ok: false, error: 'Invalid photo data' }
  }

  if (bytes.byteLength < 200 || bytes.byteLength > 6_000_000) {
    return { ok: false, error: 'Photo size is not valid' }
  }

  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
  const fileName = `employee-app/${employeeId}/break_${id}.jpg`

  const { error: uploadError } = await admin.storage.from('time-clock-photos').upload(fileName, bytes, {
    contentType: 'image/jpeg',
    upsert: false,
  })

  if (uploadError) {
    console.error('[employee-time-clock-action] break photo upload failed', uploadError)
    return { ok: false, error: uploadError.message || 'Photo upload failed' }
  }

  const { data: urlData } = admin.storage.from('time-clock-photos').getPublicUrl(fileName)
  const publicUrl = urlData?.publicUrl
  if (!publicUrl) {
    return { ok: false, error: 'Could not resolve photo URL' }
  }

  const { error: updateError } = await admin
    .from('scheduling_break_tracking')
    .update({ [column]: publicUrl })
    .eq('id', breakId)
    .eq('employee_id', employeeId)

  if (updateError) {
    console.error('[employee-time-clock-action] break photo column update failed', updateError)
    return { ok: false, error: updateError.message || 'Could not save break photo' }
  }

  return { ok: true, publicUrl }
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
    const action = String(body.action || 'status')
    const location = normalizeLocation(body.location)
    const shiftId = body.shift_id ? String(body.shift_id) : null
    const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
    /** When set (e.g. employee portal), must match a row in business_users so punches land on the same business as timesheets. */
    const requestedBusinessId =
      body.business_id != null && String(body.business_id).trim() !== ''
        ? String(body.business_id).trim()
        : null

    const { data: publicUser, error: userError } = await admin
      .from('users')
      .select('id, email, full_name, first_name, last_name')
      .eq('email', authData.user.email)
      .maybeSingle()

    if (userError || !publicUser?.id) return json({ error: 'Employee profile not found' }, 404)

    const { data: memberships, error: membershipsError } = await admin
      .from('business_users')
      .select('business_id, businesses:business_id(id, name, timezone)')
      .eq('user_id', publicUser.id)
      .order('created_at', { ascending: false })

    if (membershipsError || !memberships?.length) {
      return json({ error: 'Employee is not associated with a business' }, 403)
    }

    let businessUser = memberships[0]
    if (requestedBusinessId) {
      const found = memberships.find((m) => String(m.business_id) === requestedBusinessId)
      if (!found) {
        return json({ error: 'Employee is not associated with this business' }, 403)
      }
      businessUser = found
    }

    const businessId = businessUser.business_id
    const businessTimeZone = getBusinessTimezone(businessUser.businesses)
    const [settings, activeClock, shiftsRaw] = await Promise.all([
      loadSchedulingSettings(admin, businessId),
      getActiveClock(admin, businessId, publicUser.id, businessTimeZone),
      loadTodayShifts(admin, businessId, publicUser.id, businessTimeZone),
    ])
    const activeBreak = activeClock?.id
      ? await getActiveBreak(admin, businessId, publicUser.id, String(activeClock.id))
      : null
    const shifts = (shiftsRaw || []).map((s) => toPublicShiftRow(s as Record<string, unknown>))
    let selectedShift: Record<string, unknown> | null = null
    if (shiftId) {
      selectedShift = shifts.find((s) => String(s.id) === shiftId) || null
      if (!selectedShift) {
        const loaded = await loadShiftById(admin, businessId, publicUser.id, shiftId)
        selectedShift = loaded ? toPublicShiftRow(loaded as Record<string, unknown>) : null
      }
    }

    if (action === 'status') {
      return json({
        ok: true,
        business: businessUser.businesses,
        employee: publicUser,
        settings: publicSettings(settings),
        activeClock,
        activeBreak,
        shifts,
      })
    }

    if (action === 'clock_in') {
      if (activeClock) return json({ error: 'You are already clocked in' }, 400)
      const geofence = validateGeofence(location, settings)
      if (!geofence.ok) return json({ error: geofence.error, geofence }, 400)

      /** Employee app: never rely on manual shift_id — auto-pick best published shift for "now", or none (unknown / unlinked punch). */
      const autoShift = pickBestShiftForClockIn(new Date(), shifts, businessTimeZone)
      selectedShift = autoShift

      const clockInTime = new Date()
      const locationRecord = buildLocationRecord({ clockIn: location, geofence })
      const clockInNoteBase = buildClockNote({
        notes,
        selectedShift,
        event: lateSummary(clockInTime, selectedShift, settings, businessTimeZone),
      })
      const clockInNotes = !selectedShift
        ? [clockInNoteBase, 'Employee app: clock-in without a linked published shift (no match in schedule window).'].filter(Boolean).join('\n')
        : clockInNoteBase

      const { data: inserted, error: insertError } = await admin
        .from('scheduling_time_clocks')
        .insert({
          business_id: businessId,
          employee_id: publicUser.id,
          clock_in_time: clockInTime.toISOString(),
          device_type: 'employee_app',
          location: JSON.stringify(locationRecord),
          notes: clockInNotes,
        })
        .select('*')
        .single()

      if (insertError) {
        console.error('[employee-time-clock-action] clock_in failed', insertError)
        return json({ error: 'Failed to clock in' }, 500)
      }

      const photoAttachment = await attachClockPhotoWithServiceRole(
        admin,
        String(inserted.id),
        String(publicUser.id),
        'photo_verification_url',
        body.clock_photo_base64,
      )

      const environmentPhotoAttachment = await attachClockPhotoWithServiceRole(
        admin,
        String(inserted.id),
        String(publicUser.id),
        'clock_in_environment_photo_url',
        body.clock_environment_photo_base64,
      )

      let timeClock = inserted as Record<string, unknown>
      if (photoAttachment.ok && photoAttachment.publicUrl) {
        timeClock = { ...timeClock, photo_verification_url: photoAttachment.publicUrl }
      }
      if (environmentPhotoAttachment.ok && environmentPhotoAttachment.publicUrl) {
        timeClock = { ...timeClock, clock_in_environment_photo_url: environmentPhotoAttachment.publicUrl }
      }

      const late = lateSummary(clockInTime, selectedShift, settings, businessTimeZone)
      if (late?.shouldAlert) {
        await sendSchedulingNotification(admin, businessId, 'late_clock_in', publicUser.id, {
          employeeName: publicUser.full_name || authData.user.email,
          minutesLate: late.minutes,
          shiftId: selectedShift?.id,
          scheduledStart: late.scheduledAt?.toISOString(),
          actualClockIn: clockInTime.toISOString(),
        })
      }

      const staffNote =
        typeof selectedShift?.staff_visible_note === 'string' && String(selectedShift.staff_visible_note).trim() !== ''
          ? String(selectedShift.staff_visible_note).trim()
          : null

      return json({
        ok: true,
        action: 'clock_in',
        timeClock,
        late,
        geofence,
        photoAttachment,
        environmentPhotoAttachment,
        staff_visible_shift_note: staffNote,
        resolved_shift: selectedShift
          ? {
              id: selectedShift.id,
              shift_date: selectedShift.shift_date,
              start_time: selectedShift.start_time,
              end_time: selectedShift.end_time,
              position: selectedShift.position ?? null,
              staff_visible_note: staffNote,
            }
          : null,
      })
    }

    if (action === 'break_start') {
      if (!activeClock) return json({ error: 'You must be clocked in to start a break' }, 400)
      if (activeBreak) return json({ error: 'You are already on a break' }, 400)
      const geofence = validateGeofence(location, settings)
      if (!geofence.ok) return json({ error: geofence.error, geofence }, 400)

      const breakStartAt = new Date()
      const breakNotes = [notes, 'Break started via employee app'].filter(Boolean).join('\n') || 'Break started via employee app'
      const { data: insertedBreak, error: breakError } = await admin
        .from('scheduling_break_tracking')
        .insert({
          business_id: businessId,
          employee_id: publicUser.id,
          time_clock_id: activeClock.id,
          break_start_at: breakStartAt.toISOString(),
          notes: breakNotes,
        })
        .select('*')
        .single()

      if (breakError) {
        console.error('[employee-time-clock-action] break_start failed', breakError)
        return json({ error: 'Failed to start break' }, 500)
      }

      const photoAttachment = await attachBreakPhotoWithServiceRole(
        admin,
        String(insertedBreak.id),
        String(publicUser.id),
        'photo_url_start',
        body.clock_photo_base64,
      )

      let breakRow = insertedBreak as Record<string, unknown>
      if (photoAttachment.ok && photoAttachment.publicUrl) {
        breakRow = { ...breakRow, photo_url_start: photoAttachment.publicUrl }
      }

      return json({ ok: true, action: 'break_start', activeBreak: breakRow, geofence, photoAttachment })
    }

    if (action === 'break_end') {
      if (!activeClock) return json({ error: 'You are not currently clocked in' }, 400)
      if (!activeBreak) return json({ error: 'You are not on a break' }, 400)
      const geofence = validateGeofence(location, settings)
      if (!geofence.ok) return json({ error: geofence.error, geofence }, 400)

      const breakEndAt = new Date()
      const startMs = new Date(String(activeBreak.break_start_at)).getTime()
      const durationMinutes = Math.max(0, Math.floor((breakEndAt.getTime() - startMs) / 60000))
      const { data: updatedBreak, error: breakError } = await admin
        .from('scheduling_break_tracking')
        .update({
          break_end_at: breakEndAt.toISOString(),
          duration_minutes: durationMinutes,
        })
        .eq('id', activeBreak.id)
        .eq('employee_id', publicUser.id)
        .select('*')
        .single()

      if (breakError) {
        console.error('[employee-time-clock-action] break_end failed', breakError)
        return json({ error: 'Failed to end break' }, 500)
      }

      const photoAttachment = await attachBreakPhotoWithServiceRole(
        admin,
        String(updatedBreak.id),
        String(publicUser.id),
        'photo_url_end',
        body.clock_photo_base64,
      )

      let breakRow = updatedBreak as Record<string, unknown>
      if (photoAttachment.ok && photoAttachment.publicUrl) {
        breakRow = { ...breakRow, photo_url_end: photoAttachment.publicUrl }
      }

      return json({ ok: true, action: 'break_end', activeBreak: breakRow, geofence, photoAttachment })
    }

    if (action === 'clock_out') {
      if (!activeClock) return json({ error: 'You are not currently clocked in' }, 400)
      const geofence = validateGeofence(location, settings)
      if (!geofence.ok) return json({ error: geofence.error, geofence }, 400)

      const clockOutTime = new Date()
      if (activeBreak?.id) {
        await closeOpenBreak(admin, activeBreak, clockOutTime)
      }
      const matchedShift = selectedShift || findBestShiftForClock(activeClock.clock_in_time, shifts, businessTimeZone)
      const early = earlySummary(clockOutTime, matchedShift, settings, businessTimeZone)
      const locationRecord = mergeLocationRecord(activeClock.location, { clockOut: location, geofence })
      const totalHours = (clockOutTime.getTime() - new Date(activeClock.clock_in_time).getTime()) / 36e5
      const { data: updated, error: updateError } = await admin
        .from('scheduling_time_clocks')
        .update({
          clock_out_time: clockOutTime.toISOString(),
          total_hours: Number(totalHours.toFixed(2)),
          location: JSON.stringify(locationRecord),
          notes: buildClockNote({ notes: activeClock.notes, selectedShift: matchedShift, event: early }),
        })
        .eq('id', activeClock.id)
        .select('*')
        .single()

      if (updateError) {
        console.error('[employee-time-clock-action] clock_out failed', updateError)
        return json({ error: 'Failed to clock out' }, 500)
      }

      const photoAttachment = await attachClockPhotoWithServiceRole(
        admin,
        String(updated.id),
        String(publicUser.id),
        'clock_out_photo_url',
        body.clock_photo_base64,
      )

      const environmentPhotoAttachment = await attachClockPhotoWithServiceRole(
        admin,
        String(updated.id),
        String(publicUser.id),
        'clock_out_environment_photo_url',
        body.clock_environment_photo_base64,
      )

      let timeClock = updated as Record<string, unknown>
      if (photoAttachment.ok && photoAttachment.publicUrl) {
        timeClock = { ...timeClock, clock_out_photo_url: photoAttachment.publicUrl }
      }
      if (environmentPhotoAttachment.ok && environmentPhotoAttachment.publicUrl) {
        timeClock = { ...timeClock, clock_out_environment_photo_url: environmentPhotoAttachment.publicUrl }
      }

      if (early?.shouldAlert) {
        await sendSchedulingNotification(admin, businessId, 'early_clock_out', publicUser.id, {
          employeeName: publicUser.full_name || authData.user.email,
          minutesEarly: early.minutes,
          shiftId: matchedShift?.id,
          scheduledEnd: early.scheduledAt?.toISOString(),
          actualClockOut: clockOutTime.toISOString(),
        })
      }

      return json({
        ok: true,
        action: 'clock_out',
        timeClock,
        early,
        geofence,
        photoAttachment,
        environmentPhotoAttachment,
      })
    }

    return json({ error: 'Invalid action' }, 400)
  } catch (error) {
    console.error('[employee-time-clock-action] unexpected error', error)
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeLocation(value: unknown): LocationPayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const latitude = Number(raw.latitude)
  const longitude = Number(raw.longitude)
  const accuracy = raw.accuracy == null ? undefined : Number(raw.accuracy)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return { latitude, longitude, accuracy: Number.isFinite(accuracy) ? accuracy : undefined }
}

async function loadSchedulingSettings(admin: ReturnType<typeof createClient>, businessId: string) {
  const { data } = await admin
    .from('scheduling_settings')
    .select('*')
    .eq('business_id', businessId)
    .maybeSingle()

  return {
    time_clock_geofence_enabled: data?.time_clock_geofence_enabled === true,
    time_clock_geofence_latitude: toNumber(data?.time_clock_geofence_latitude),
    time_clock_geofence_longitude: toNumber(data?.time_clock_geofence_longitude),
    time_clock_geofence_radius_meters: toNumber(data?.time_clock_geofence_radius_meters) || 150,
    time_clock_late_grace_minutes: toNumber(data?.time_clock_late_grace_minutes) ?? 5,
    time_clock_early_clock_out_grace_minutes: toNumber(data?.time_clock_early_clock_out_grace_minutes) ?? 5,
    allow_employee_app_unscheduled_clock_in: data?.allow_employee_app_unscheduled_clock_in !== false,
  }
}

function publicSettings(settings: Record<string, unknown>) {
  return {
    geofenceEnabled: settings.time_clock_geofence_enabled,
    geofenceRadiusMeters: settings.time_clock_geofence_radius_meters,
    lateGraceMinutes: settings.time_clock_late_grace_minutes,
    earlyClockOutGraceMinutes: settings.time_clock_early_clock_out_grace_minutes,
    allowUnscheduledClockIn: settings.allow_employee_app_unscheduled_clock_in,
  }
}

const STALE_OPEN_PUNCH_NOTE = 'System auto-closed stale open punch (no clock-out recorded).'

async function getActiveClock(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  employeeId: string,
  timeZone: string,
) {
  const todayKey = getDateInTimeZone(new Date(), timeZone)
  const { data: openPunches, error } = await admin
    .from('scheduling_time_clocks')
    .select('*')
    .eq('business_id', businessId)
    .eq('employee_id', employeeId)
    .is('clock_out_time', null)
    .order('clock_in_time', { ascending: false })

  if (error) {
    console.error('[employee-time-clock-action] open punch lookup failed', error)
    return null
  }

  let activeToday: Record<string, unknown> | null = null
  for (const punch of openPunches || []) {
    const punchDay = getDateInTimeZone(new Date(String(punch.clock_in_time)), timeZone)
    if (punchDay === todayKey) {
      if (!activeToday) activeToday = punch as Record<string, unknown>
      continue
    }
    const staleOut = zonedDateTimeToUtc(punchDay, '23:59:59', timeZone).toISOString()
    const existingNotes = typeof punch.notes === 'string' ? punch.notes.trim() : ''
    const notes = existingNotes ? `${existingNotes}\n${STALE_OPEN_PUNCH_NOTE}` : STALE_OPEN_PUNCH_NOTE
    const { error: updErr } = await admin
      .from('scheduling_time_clocks')
      .update({
        clock_out_time: staleOut,
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', punch.id)
      .eq('business_id', businessId)
    if (updErr) {
      console.error('[employee-time-clock-action] stale punch close failed', updErr)
    }
  }
  return activeToday
}

async function getActiveBreak(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  employeeId: string,
  timeClockId: string,
) {
  const { data } = await admin
    .from('scheduling_break_tracking')
    .select('*')
    .eq('business_id', businessId)
    .eq('employee_id', employeeId)
    .eq('time_clock_id', timeClockId)
    .is('break_end_at', null)
    .order('break_start_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

async function closeOpenBreak(
  admin: ReturnType<typeof createClient>,
  breakRow: Record<string, unknown>,
  endTime: Date,
) {
  if (!breakRow?.id || breakRow.break_end_at) return
  const startMs = new Date(String(breakRow.break_start_at)).getTime()
  const durationMinutes = Math.max(0, Math.floor((endTime.getTime() - startMs) / 60000))
  const priorNotes = typeof breakRow.notes === 'string' ? breakRow.notes.trim() : ''
  await admin
    .from('scheduling_break_tracking')
    .update({
      break_end_at: endTime.toISOString(),
      duration_minutes: durationMinutes,
      notes: priorNotes
        ? `${priorNotes}\nAuto-closed when ending shift (employee app).`
        : 'Auto-closed when ending shift (employee app).',
    })
    .eq('id', breakRow.id)
}

async function loadTodayShifts(admin: ReturnType<typeof createClient>, businessId: string, employeeId: string, timeZone: string) {
  const today = getDateInTimeZone(new Date(), timeZone)
  const start = addDaysToDateString(today, -1)
  const end = addDaysToDateString(today, 1)
  const { data } = await admin
    .from('scheduling_shifts')
    .select(
      'id, business_id, employee_id, shift_date, start_time, end_time, status, position, is_published, notes, notes_visible_to_staff',
    )
    .eq('business_id', businessId)
    .eq('employee_id', employeeId)
    .gte('shift_date', start)
    .lte('shift_date', end)
    .order('shift_date', { ascending: true })
    .order('start_time', { ascending: true })
  return (data || []).filter((shift) => shift.is_published !== false)
}

async function loadShiftById(admin: ReturnType<typeof createClient>, businessId: string, employeeId: string, shiftId: string) {
  const { data } = await admin
    .from('scheduling_shifts')
    .select(
      'id, business_id, employee_id, shift_date, start_time, end_time, status, position, is_published, notes, notes_visible_to_staff',
    )
    .eq('id', shiftId)
    .eq('business_id', businessId)
    .eq('employee_id', employeeId)
    .maybeSingle()
  return data?.is_published === false ? null : data
}

/** Strip manager-only shift notes before returning shifts to the employee app. */
function staffVisibleShiftNoteFromRow(shift: Record<string, unknown> | null | undefined): string | null {
  if (!shift) return null
  const text = typeof shift.notes === 'string' ? shift.notes.trim() : ''
  if (!text) return null
  if (shift.notes_visible_to_staff !== true) return null
  return text
}

function toPublicShiftRow(shift: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!shift) return null
  return {
    id: shift.id,
    business_id: shift.business_id,
    employee_id: shift.employee_id,
    shift_date: shift.shift_date,
    start_time: shift.start_time,
    end_time: shift.end_time,
    status: shift.status,
    position: shift.position,
    staff_visible_note: staffVisibleShiftNoteFromRow(shift),
  }
}

function validateGeofence(location: LocationPayload | null, settings: Record<string, unknown>) {
  if (!settings.time_clock_geofence_enabled) return { ok: true, enforced: false }
  if (!location) return { ok: false, enforced: true, error: 'Location is required to clock in or out' }
  const targetLat = Number(settings.time_clock_geofence_latitude)
  const targetLng = Number(settings.time_clock_geofence_longitude)
  const radius = Number(settings.time_clock_geofence_radius_meters || 150)
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
    return { ok: true, enforced: false, warning: 'Geofence is enabled but no business coordinates are configured' }
  }
  const distanceMeters = haversineMeters(location.latitude!, location.longitude!, targetLat, targetLng)
  return {
    ok: distanceMeters <= radius,
    enforced: true,
    distanceMeters: Math.round(distanceMeters),
    radiusMeters: radius,
    error: distanceMeters <= radius ? undefined : `You are outside the allowed clock-in area (${Math.round(distanceMeters)}m away).`,
  }
}

function lateSummary(actual: Date, shift: Record<string, unknown> | null, settings: Record<string, unknown>, timeZone: string) {
  if (!shift?.shift_date || !shift?.start_time) return null
  const scheduledAt = zonedDateTimeToUtc(String(shift.shift_date), String(shift.start_time), timeZone)
  const minutes = Math.floor((actual.getTime() - scheduledAt.getTime()) / 60000)
  const grace = Number(settings.time_clock_late_grace_minutes ?? 5)
  return { type: 'late_clock_in', minutes, scheduledAt, shouldAlert: minutes > grace, graceMinutes: grace }
}

function earlySummary(actual: Date, shift: Record<string, unknown> | null, settings: Record<string, unknown>, timeZone: string) {
  if (!shift?.shift_date || !shift?.end_time) return null
  const start = shift.start_time
    ? zonedDateTimeToUtc(String(shift.shift_date), String(shift.start_time), timeZone)
    : null
  const scheduledAtBase = zonedDateTimeToUtc(String(shift.shift_date), String(shift.end_time), timeZone)
  const scheduledAt = start && scheduledAtBase <= start ? addMinutes(scheduledAtBase, 1440) : scheduledAtBase
  const minutes = Math.floor((scheduledAt.getTime() - actual.getTime()) / 60000)
  const grace = Number(settings.time_clock_early_clock_out_grace_minutes ?? 5)
  return { type: 'early_clock_out', minutes, scheduledAt, shouldAlert: minutes > grace, graceMinutes: grace }
}

function buildClockNote({ notes, selectedShift, event }: { notes?: string | null; selectedShift?: Record<string, unknown> | null; event?: Record<string, unknown> | null }) {
  const parts = [notes || ''].filter(Boolean)
  if (selectedShift?.shift_date && selectedShift?.start_time && selectedShift?.end_time) {
    const pos = selectedShift.position ? ` · ${selectedShift.position}` : ''
    const st = String(selectedShift.start_time).slice(0, 5)
    const en = String(selectedShift.end_time).slice(0, 5)
    parts.push(`Scheduled shift: ${selectedShift.shift_date} ${st}–${en}${pos}`)
  } else if (selectedShift?.id) {
    parts.push('Scheduled shift: linked from employee app')
  }
  if (event?.shouldAlert) {
    const t = String(event.type || '')
    const m = Number(event.minutes ?? 0)
    if (t === 'late_clock_in') {
      parts.push(`Late clock-in: about ${m} minutes after scheduled start (past grace)`)
    } else if (t === 'early_clock_out') {
      parts.push(`Early clock-out: about ${m} minutes before scheduled end (past grace)`)
    } else {
      parts.push(`Attendance flag (${t}): ${m} minutes`)
    }
  }
  return parts.join('\n') || null
}

function buildLocationRecord(entry: Record<string, unknown>) {
  return { source: 'employee_app', ...entry, capturedAt: new Date().toISOString() }
}

function mergeLocationRecord(existing: string | null, next: Record<string, unknown>) {
  let parsed: Record<string, unknown> = {}
  try {
    parsed = existing ? JSON.parse(existing) : {}
  } catch {
    parsed = { legacyLocation: existing }
  }
  return { ...parsed, ...next, updatedAt: new Date().toISOString(), source: 'employee_app' }
}

function findBestShiftForClock(clockInTime: string, shifts: Record<string, unknown>[], timeZone: string) {
  const clockDate = getDateInTimeZone(new Date(clockInTime), timeZone)
  return shifts.find((shift) => shift.shift_date === clockDate) || shifts[0] || null
}

/** Pick the published shift that best matches an immediate clock-in (employee app — no manual selection). */
function pickBestShiftForClockIn(now: Date, publicShifts: Record<string, unknown>[], timeZone: string): Record<string, unknown> | null {
  const list = (publicShifts || []).filter(Boolean) as Record<string, unknown>[]
  if (list.length === 0) return null

  const bounds = list.map((shift) => {
    const sd = String(shift.shift_date || '')
    const st = String(shift.start_time || '00:00:00')
    const en = String(shift.end_time || '00:00:00')
    let startMs = zonedDateTimeToUtc(sd, st, timeZone).getTime()
    let endMs = zonedDateTimeToUtc(sd, en, timeZone).getTime()
    if (endMs <= startMs) endMs += 24 * 60 * 60 * 1000
    return { shift, startMs, endMs, sd }
  })

  const t = now.getTime()
  const inProgress = bounds.filter((b) => t >= b.startMs && t <= b.endMs)
  if (inProgress.length > 0) {
    inProgress.sort((a, b) => a.startMs - b.startMs)
    return inProgress[0].shift
  }

  const today = getDateInTimeZone(now, timeZone)
  const todayBounds = bounds.filter((b) => b.sd === today)

  const upcomingToday = todayBounds.filter((b) => t < b.startMs).sort((a, b) => a.startMs - b.startMs)
  if (upcomingToday.length > 0) return upcomingToday[0].shift

  const endedToday = todayBounds.filter((b) => t > b.endMs).sort((a, b) => b.endMs - a.endMs)
  if (endedToday.length > 0) return endedToday[0].shift

  const upcomingAny = bounds.filter((b) => t < b.startMs).sort((a, b) => a.startMs - b.startMs)
  if (upcomingAny.length > 0) return upcomingAny[0].shift

  const endedAny = bounds.filter((b) => t > b.endMs).sort((a, b) => b.endMs - a.endMs)
  if (endedAny.length > 0) return endedAny[0].shift

  bounds.sort((a, b) => (a.sd !== b.sd ? a.sd.localeCompare(b.sd) : a.startMs - b.startMs))
  return bounds[0]?.shift ?? null
}

async function sendSchedulingNotification(admin: ReturnType<typeof createClient>, businessId: string, eventKey: string, employeeId: string, context: Record<string, unknown>) {
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
      body: JSON.stringify({ businessId, eventKey, employeeId, context, force: false }),
    })
  } catch (error) {
    console.warn('[employee-time-clock-action] notification failed', error)
  }
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
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

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000)
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radius = 6371000
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
