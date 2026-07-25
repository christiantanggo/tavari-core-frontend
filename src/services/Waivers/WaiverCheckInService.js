import { supabase } from '../../supabaseClient';
import {
  isLegacyWaiverId,
  normalizeDashboardWaiverId,
  parseLegacyWaiverUuid
} from '../../constants/legacyWaiver';
import { isWaiverExpired } from '../../utils/waiverUtils';

/** Stable lookup key: participant UUID or sentinel for primary when waiver_participant_id is null. */
export function waiverCheckInMapKey(waiverId, waiverParticipantId) {
  const wid = waiverId != null && waiverId !== '' ? normalizeDashboardWaiverId(waiverId) : '';
  if (!wid) return '__missing_waiver__:__primary__';
  if (waiverParticipantId) return `${wid}:${waiverParticipantId}`;
  return `${wid}:__primary__`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

/**
 * Resolve today's check-in row for the dashboard checkbox.
 * Booking check-ins often store `booking_participants.waiver_participant_id` as null (links only
 * `waiver_id`), which maps to `…:__primary__`, while this UI passes the primary row's
 * `waiver_participants.id` when one exists — same mismatch `fetchTodayWaiverCheckIns` fixes via
 * duplicate keys for primary_signer.
 *
 * @param {Map<string, unknown>} checkInsMap
 * @param {string} waiverId
 * @param {string|null|undefined} waiverParticipantId
 * @param {'primary_signer'|'minor'|'additional_adult'} [subjectType]
 * @returns {{ rec: { id?: string|null, checked_in_at?: string, bookingClears?: { participantId: string, bookingId: string }[] } | null, mapKeysToInvalidate: string[] }}
 */
export function resolveTodayCheckInRecord(checkInsMap, waiverId, waiverParticipantId, subjectType) {
  const directKey = waiverCheckInMapKey(waiverId, waiverParticipantId);
  const direct = checkInsMap.get(directKey);
  if (direct) {
    return { rec: direct, mapKeysToInvalidate: [directKey] };
  }
  if (subjectType === 'primary_signer' && waiverParticipantId) {
    const primarySentinelKey = waiverCheckInMapKey(waiverId, null);
    const alt = checkInsMap.get(primarySentinelKey);
    if (alt) {
      return { rec: alt, mapKeysToInvalidate: [directKey, primarySentinelKey] };
    }
  }
  return { rec: null, mapKeysToInvalidate: [directKey] };
}

/**
 * @param {string} businessId
 * @param {string[]} waiverIds
 * @returns {Promise<Map<string, { id: string, checked_in_at: string, display_name: string }>>} latest row per person today (local calendar day start)
 */
export async function fetchTodayWaiverCheckIns(businessId, waiverIds) {
  if (!businessId || !waiverIds?.length) return new Map();

  const normalizedIds = [...new Set(waiverIds.map((id) => normalizeDashboardWaiverId(id)).filter(Boolean))];
  const modernWaiverIds = [...new Set(normalizedIds.filter((id) => !isLegacyWaiverId(id)))];
  const legacyWaiverIds = [
    ...new Set(normalizedIds.map((id) => parseLegacyWaiverUuid(id)).filter(Boolean))
  ];
  if (modernWaiverIds.length === 0 && legacyWaiverIds.length === 0) return new Map();

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const selectCols = 'id, waiver_id, legacy_waiver_id, legacy_participant_key, waiver_participant_id, display_name, checked_in_at, subject_type';
  const queries = [];
  if (modernWaiverIds.length > 0) {
    queries.push(
      supabase
        .from('waiver_participant_check_ins')
        .select(selectCols)
        .eq('business_id', businessId)
        .in('waiver_id', modernWaiverIds)
        .gte('checked_in_at', start.toISOString())
        .order('checked_in_at', { ascending: false })
    );
  }
  if (legacyWaiverIds.length > 0) {
    queries.push(
      supabase
        .from('waiver_participant_check_ins')
        .select(selectCols)
        .eq('business_id', businessId)
        .in('legacy_waiver_id', legacyWaiverIds)
        .gte('checked_in_at', start.toISOString())
        .order('checked_in_at', { ascending: false })
    );
  }

  const results = await Promise.all(queries);
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) throw firstError;
  const data = results.flatMap((result) => result.data || []);

  const map = new Map();
  for (const row of data || []) {
    const dashboardWaiverId = normalizeDashboardWaiverId(
      row.legacy_waiver_id ? `legacy-${row.legacy_waiver_id}` : row.waiver_id
    );
    const participantKey = row.legacy_participant_key || row.waiver_participant_id;
    const keys = [waiverCheckInMapKey(dashboardWaiverId, participantKey)];
    if (row.subject_type === 'primary_signer' && participantKey) {
      keys.push(waiverCheckInMapKey(dashboardWaiverId, null));
    }
    for (const key of keys) {
      if (!map.has(key)) {
        map.set(key, {
          id: row.id,
          checked_in_at: row.checked_in_at,
          display_name: row.display_name,
          bookingClears: []
        });
      }
    }
  }
  return map;
}

const tsIso = (iso) => (iso ? new Date(iso).getTime() : 0);

/**
 * Booking-module check-ins (`booking_participants.checked_in_at`) for waivers linked on the participant row.
 * Same "today" window as `fetchTodayWaiverCheckIns` (browser-local midnight → now).
 * Values include `bookingClears` so the dashboard can undo booking check-in when clearing the box.
 *
 * @param {string} businessId
 * @param {string[]} waiverIds
 * @returns {Promise<Map<string, { id: null, checked_in_at: string, display_name: string, bookingClears: { participantId: string, bookingId: string }[] }>>}
 */
export async function fetchTodayBookingCheckInsForWaivers(businessId, waiverIds) {
  if (!businessId || !waiverIds?.length) return new Map();
  const normalizedIds = [...new Set(waiverIds.map((id) => normalizeDashboardWaiverId(id)).filter(Boolean))];
  const modernWaiverIds = [...new Set(normalizedIds.filter((id) => !isLegacyWaiverId(id)))];
  if (modernWaiverIds.length === 0) return new Map();

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  // Prod may omit first_name/last_name on booking_participants (names live on joined waiver/customer rows).
  let query = supabase
    .from('booking_participants')
    .select(
      'id, booking_id, waiver_id, waiver_participant_id, checked_in_at, bookings!inner(business_id), waiver_participants!booking_participants_waiver_participant_id_fkey ( participant_type )'
    )
    .eq('bookings.business_id', businessId)
    .in('waiver_id', modernWaiverIds)
    .not('waiver_id', 'is', null)
    .not('checked_in_at', 'is', null)
    .gte('checked_in_at', start.toISOString())
    .order('checked_in_at', { ascending: false });

  let { data, error } = await query;

  if (error) {
    ({ data, error } = await supabase
      .from('booking_participants')
      .select('id, booking_id, waiver_id, waiver_participant_id, checked_in_at, bookings!inner(business_id)')
      .eq('bookings.business_id', businessId)
      .in('waiver_id', modernWaiverIds)
      .not('waiver_id', 'is', null)
      .not('checked_in_at', 'is', null)
      .gte('checked_in_at', start.toISOString())
      .order('checked_in_at', { ascending: false }));
  }

  if (error) throw error;

  /** @type {Map<string, { id: null, checked_in_at: string, display_name: string, bookingClears: { participantId: string, bookingId: string }[] }>} */
  const byKey = new Map();

  const applyRowToKey = (key, row, clear) => {
    const name = 'Booking check-in';
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        id: null,
        checked_in_at: row.checked_in_at,
        display_name: name,
        bookingClears: [clear]
      });
    } else {
      if (tsIso(row.checked_in_at) > tsIso(existing.checked_in_at)) {
        existing.checked_in_at = row.checked_in_at;
      }
      if (!existing.bookingClears.some((c) => c.participantId === clear.participantId)) {
        existing.bookingClears.push(clear);
      }
    }
  };

  for (const row of data || []) {
    const clear = { participantId: row.id, bookingId: row.booking_id };
    const keys = new Set();
    keys.add(waiverCheckInMapKey(row.waiver_id, row.waiver_participant_id));

    const wp = row.waiver_participants;
    const wpRow = wp && (Array.isArray(wp) ? wp[0] : wp);
    const pt = String(wpRow?.participant_type || '').toLowerCase();
    if (row.waiver_participant_id == null || pt === 'primary' || pt === 'primary_signer') {
      keys.add(waiverCheckInMapKey(row.waiver_id, null));
    }

    for (const key of keys) {
      applyRowToKey(key, row, clear);
    }
  }

  return byKey;
}

/**
 * "Checked in today" map for the waivers dashboard: venue waiver rows + booking participant check-ins.
 * @param {string} businessId
 * @param {string[]} waiverIds
 */
export async function fetchTodayWaiverAndBookingCheckIns(businessId, waiverIds) {
  const [waiverMap, bookingMap] = await Promise.all([
    fetchTodayWaiverCheckIns(businessId, waiverIds),
    fetchTodayBookingCheckInsForWaivers(businessId, waiverIds).catch((err) => {
      console.warn('[WaiverCheckInService] booking-module today check-ins skipped:', err);
      return new Map();
    })
  ]);

  const out = new Map(waiverMap);

  for (const [key, b] of bookingMap) {
    const w = out.get(key);
    if (!w) {
      out.set(key, {
        id: null,
        checked_in_at: b.checked_in_at,
        display_name: b.display_name,
        bookingClears: [...(b.bookingClears || [])]
      });
      continue;
    }

    const checked =
      tsIso(b.checked_in_at) > tsIso(w.checked_in_at) ? b.checked_in_at : w.checked_in_at;
    const mergedClears = [...(w.bookingClears || []), ...(b.bookingClears || [])];
    const seen = new Set();
    const bookingClears = mergedClears.filter((c) => {
      if (!c?.participantId || seen.has(c.participantId)) return false;
      seen.add(c.participantId);
      return true;
    });

    out.set(key, {
      ...w,
      checked_in_at: checked,
      display_name:
        tsIso(b.checked_in_at) > tsIso(w.checked_in_at) ? b.display_name : w.display_name,
      bookingClears: bookingClears.length ? bookingClears : w.bookingClears || []
    });
  }

  return out;
}

/**
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.waiverId - waiver_signatures.id
 * @param {string|null} params.waiverParticipantId
 * @param {'primary_signer'|'minor'|'additional_adult'} params.subjectType
 * @param {string} params.displayName
 */
const CHECKIN_EXPIRED_MESSAGE = 'This waiver has expired. Check-in is not allowed.';

/**
 * @returns {Promise<{ customer_id: string | null }>} throws with user-facing message if waiver is not valid for check-in
 */
async function assertWaiverNotExpiredForCheckIn(businessId, waiverId) {
  if (isLegacyWaiverId(waiverId)) {
    const legacyWaiverId = parseLegacyWaiverUuid(waiverId);
    const { data: w, error: wErr } = await supabase
      .from('legacy_waivers')
      .select('id, signed_at, created_at, customer_id')
      .eq('id', legacyWaiverId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (wErr) throw wErr;
    if (!w) {
      const err = new Error('Waiver not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    const signedAt = w.signed_at || w.created_at;
    if (signedAt) {
      const { data: setting } = await supabase
        .from('waiver_settings')
        .select('setting_value')
        .eq('business_id', businessId)
        .eq('setting_key', 'default_expiry_days')
        .is('template_id', null)
        .maybeSingle();
      const rawDays = setting?.setting_value;
      const n = rawDays != null && rawDays !== '' ? parseInt(String(rawDays).replace(/"/g, ''), 10) : NaN;
      if (Number.isFinite(n) && n > 0) {
        const end = new Date(new Date(signedAt).getTime() + n * 864e5);
        if (end <= new Date()) {
          throw new Error(CHECKIN_EXPIRED_MESSAGE);
        }
      }
    }

    return { customer_id: w.customer_id ?? null };
  }

  const { data: w, error: wErr } = await supabase
    .from('waiver_signatures')
    .select('is_valid, expires_at, signed_at, customer_id, waiver_templates: template_id ( expiry_days )')
    .eq('id', waiverId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (wErr) throw wErr;
  if (!w) {
    const err = new Error('Waiver not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (w.is_valid === false) {
    throw new Error('This waiver is no longer valid. Check-in is not allowed.');
  }

  if (w.expires_at) {
    if (isWaiverExpired(w.expires_at)) {
      throw new Error(CHECKIN_EXPIRED_MESSAGE);
    }
    return { customer_id: w.customer_id ?? null };
  }

  if (w.signed_at) {
    const rawDays = w.waiver_templates?.expiry_days;
    const n = rawDays != null && rawDays !== '' ? parseInt(String(rawDays), 10) : NaN;
    if (Number.isFinite(n) && n > 0) {
      const end = new Date(new Date(w.signed_at).getTime() + n * 864e5);
      if (end <= new Date()) {
        throw new Error(CHECKIN_EXPIRED_MESSAGE);
      }
    }
  }

  return { customer_id: w.customer_id ?? null };
}

/**
 * @param {string} businessId
 * @param {string|null|undefined} customerId - `pos_loyalty_accounts.id` from `waiver_signatures.customer_id`
 */
export async function assertLoyaltyCustomerNotBlockedForCheckIn(businessId, customerId) {
  if (!customerId) return;
  const { data, error } = await supabase
    .from('pos_loyalty_accounts')
    .select('restrict_check_in, customer_name')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) throw error;
  if (data?.restrict_check_in) {
    const who = data.customer_name ? ` (${data.customer_name})` : '';
    throw new Error(
      `Check-in is blocked for this customer account${who}. Update the account in POS → Customers if this is a mistake.`
    );
  }
}

/**
 * Human-facing hint for why a post-check-in review email was not sent (or errored).
 * The edge function often returns 200 with `skipped` / `skipped_reason` instead of throwing.
 * @param {object|null|undefined} fnData - JSON body from `mail-waiver-check-in-automation`
 * @param {import('@supabase/supabase-js').FunctionsError|null|undefined} invokeError
 * @returns {{ level: 'error' | 'info'; text: string } | null}
 */
export function reviewEmailResultUserHint(fnData, invokeError) {
  if (invokeError) {
    return {
      level: 'error',
      text: `Review email could not be sent: ${invokeError.message || 'Request failed'}. Check Mail & Reputation settings, or the browser console.`
    };
  }
  if (fnData == null || typeof fnData !== 'object') {
    return {
      level: 'info',
      text: 'Could not confirm whether the review email ran. If none arrives, set up a Mail automation for "Waiver Check-In Review" and turn it on.'
    };
  }
  if (fnData.error && String(fnData.error).trim()) {
    return { level: 'error', text: String(fnData.error) };
  }
  if (fnData.skipped === 'reputation_waiver_review_email_disabled') {
    return {
      level: 'info',
      text: 'Check-in saved. Review emails are turned off in Reputation → settings (Waiver check-in review).'
    };
  }
  if (fnData.skipped === 'adults_only_excludes_minors') {
    return {
      level: 'info',
      text: 'Check-in saved. Review email was skipped (this person is a minor; adjust "Adults only" in Reputation if you want emails for minors).'
    };
  }
  if (fnData.scheduled === true) {
    return {
      level: 'info',
      text: 'Check-in saved. Review email is scheduled for a later time (see Reputation → delay).'
    };
  }
  if (fnData.skipped_reason === 'no_recipient_email') {
    return {
      level: 'info',
      text: 'Check-in saved, but there is no email on this waiver (or linked customer). Add an email to send review requests.'
    };
  }
  if (fnData.skipped_reason === 'no_enabled_review_automation') {
    return {
      level: 'info',
      text: 'Check-in saved. Turn on a Mail automation with trigger "Waiver check-in review" (toggle Enabled) to send the email.'
    };
  }
  if (fnData.skipped_reason === 'waiver_not_found' || fnData.skipped_reason === 'check_in_not_found') {
    return { level: 'error', text: 'Check-in was saved, but the review email step could not find waiver/check-in data.' };
  }
  const sent = Number(fnData.sent) || 0;
  if (sent > 0) {
    return null;
  }
  if (Array.isArray(fnData.errors) && fnData.errors.length) {
    const first = fnData.errors[0];
    const errMsg =
      (first && typeof first === 'object' && (first.error || first.message)) || String(first);
    return { level: 'error', text: `Review email send failed: ${errMsg}` };
  }
  if (Array.isArray(fnData.skipped_items) && fnData.skipped_items.length) {
    return {
      level: 'info',
      text: 'Check-in saved. The review automation was skipped (e.g. campaign missing subject or body). Complete the template in Mail → automations.'
    };
  }
  if (fnData.ok === true && sent === 0) {
    return {
      level: 'info',
      text: 'Check-in saved, but no review email was sent. Confirm Reputation, Mail automation (Enabled), and that the template has a subject and body.'
    };
  }
  return null;
}

export async function recordWaiverParticipantCheckIn({
  businessId,
  waiverId,
  waiverParticipantId,
  subjectType,
  displayName
}) {
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { customer_id: loyaltyCustomerId } = await assertWaiverNotExpiredForCheckIn(
    businessId,
    waiverId
  );
  await assertLoyaltyCustomerNotBlockedForCheckIn(businessId, loyaltyCustomerId);

  const legacyWaiverId = parseLegacyWaiverUuid(waiverId);
  const legacyParticipantKey =
    legacyWaiverId && waiverParticipantId ? String(waiverParticipantId) : null;
  const waiverSourceColumns = legacyWaiverId
    ? { waiver_id: null, legacy_waiver_id: legacyWaiverId }
    : { waiver_id: waiverId, legacy_waiver_id: null };

  const { data, error } = await supabase
    .from('waiver_participant_check_ins')
    .insert({
      business_id: businessId,
      ...waiverSourceColumns,
      waiver_participant_id: legacyWaiverId
        ? null
        : waiverParticipantId && isUuid(waiverParticipantId)
          ? waiverParticipantId
          : null,
      legacy_participant_key: legacyParticipantKey,
      subject_type: subjectType,
      display_name: displayName,
      checked_in_by_user_id: user?.id ?? null
    })
    .select('id, checked_in_at')
    .single();

  if (error) throw error;

  // Keep the parent waiver's own activity timestamp aligned with check-in activity.
  // This makes overview ordering consistent for both modern and imported legacy waivers,
  // including paths that load/sort from the waiver rows before check-in rows are merged.
  if (data?.checked_in_at) {
    const table = legacyWaiverId ? 'legacy_waivers' : 'waiver_signatures';
    const idColumn = 'id';
    const sourceId = legacyWaiverId || waiverId;
    const { error: touchError } = await supabase
      .from(table)
      .update({ updated_at: data.checked_in_at })
      .eq(idColumn, sourceId)
      .eq('business_id', businessId);
    if (touchError) {
      console.warn('[WaiverCheckInService] Failed to update parent waiver activity timestamp:', touchError);
    }
  }

  let reviewEmailHint = null;
  if (!legacyWaiverId) {
    const { data: reviewFnData, error: reviewFnError } = await supabase.functions.invoke(
      'mail-waiver-check-in-automation',
      {
        body: {
          businessId,
          checkInId: data.id,
          waiverId,
          waiverParticipantId,
          subjectType,
          displayName
        }
      }
    );
    if (reviewFnError) {
      console.warn('[WaiverCheckInService] Review request automation failed:', reviewFnError);
    }
    reviewEmailHint = reviewEmailResultUserHint(reviewFnData, reviewFnError);
  }
  return {
    ...data,
    reviewEmailHint
  };
}

/** Remove today's check-in row (undo mistaken check-in). */
export async function deleteWaiverParticipantCheckIn(checkInId) {
  if (!checkInId) return;
  const { error } = await supabase.from('waiver_participant_check_ins').delete().eq('id', checkInId);
  if (error) throw error;
}

/**
 * Delete today's check-in row(s) for one person on a waiver.
 * Uses subject_type so primary signer clears even if waiver_participant_id was null in DB but UI uses a primary row id (or vice versa).
 * Removes every matching row today (fetch only shows latest per key; older rows must not leave the box stuck checked).
 *
 * @param {'primary_signer'|'minor'|'additional_adult'} [subjectType]
 */
export async function deleteTodayWaiverCheckInForParticipant(
  businessId,
  waiverId,
  waiverParticipantId,
  subjectType
) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const legacyWaiverId = parseLegacyWaiverUuid(waiverId);
  let q = supabase
    .from('waiver_participant_check_ins')
    .delete()
    .eq('business_id', businessId)
    .gte('checked_in_at', start.toISOString());

  q = legacyWaiverId
    ? q.eq('legacy_waiver_id', legacyWaiverId)
    : q.eq('waiver_id', waiverId);

  if (subjectType === 'primary_signer') {
    q = q.eq('subject_type', 'primary_signer');
  } else if (subjectType === 'minor' || subjectType === 'additional_adult') {
    q = q.eq('subject_type', subjectType);
    if (legacyWaiverId) {
      if (waiverParticipantId == null || waiverParticipantId === undefined) {
        q = q.is('legacy_participant_key', null);
      } else {
        q = q.eq('legacy_participant_key', String(waiverParticipantId));
      }
    } else if (waiverParticipantId == null || waiverParticipantId === undefined) {
      q = q.is('waiver_participant_id', null);
    } else {
      q = q.eq('waiver_participant_id', waiverParticipantId);
    }
  } else {
    if (legacyWaiverId) {
      if (waiverParticipantId == null || waiverParticipantId === undefined) {
        q = q.is('legacy_participant_key', null);
      } else {
        q = q.eq('legacy_participant_key', String(waiverParticipantId));
      }
    } else if (waiverParticipantId == null || waiverParticipantId === undefined) {
      q = q.is('waiver_participant_id', null);
    } else {
      q = q.eq('waiver_participant_id', waiverParticipantId);
    }
  }

  const { error } = await q;
  if (error) throw error;
}
