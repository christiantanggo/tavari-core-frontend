import { supabase } from '../../supabaseClient';
import { validateAnyManagerPin } from '../managerPinValidation';
import { participantCountsTowardCapacity } from './bookingCapacity';
import {
  activityCountsAllParticipantsByType,
  activityCountsCampersByType,
  activityCountsParticipantsByType,
} from './bookingActivityScheduleHelpers';

function normalizeTimeForDb(timeValue) {
  if (!timeValue) return null;
  const raw = String(timeValue).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
    const parts = raw.split(':');
    const h = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const s = parts[2] ? parts[2].padStart(2, '0') : '00';
    return `${h}:${m}:${s}`;
  }
  return raw;
}

export async function fetchEffectiveSlotCapacity({
  businessId,
  activityId,
  bookingDate,
  bookingTime,
  excludeBookingId = null,
}) {
  const { data, error } = await supabase.rpc('booking_effective_slot_capacity', {
    p_business_id: businessId,
    p_activity_id: activityId,
    p_booking_date: bookingDate,
    p_booking_time: normalizeTimeForDb(bookingTime),
    p_exclude_booking_id: excludeBookingId || null,
  });
  if (error) throw error;
  return data && typeof data === 'object' ? data : {};
}

export async function validateCategoryCapacity({
  businessId,
  activityId,
  bookingDate,
  bookingTime,
  unitsRequested = 1,
  overrideId = null,
}) {
  const { data, error } = await supabase.rpc('booking_validate_category_capacity', {
    p_business_id: businessId,
    p_activity_id: activityId,
    p_booking_date: bookingDate,
    p_booking_time: normalizeTimeForDb(bookingTime),
    p_units_requested: Math.max(1, Number.parseInt(unitsRequested, 10) || 1),
    p_override_id: overrideId || null,
  });
  if (error) throw error;
  return data && typeof data === 'object' ? data : { ok: false, message: 'Capacity check failed.' };
}

export async function recordCategoryCapacityOverride({
  businessId,
  bookingTypeId,
  bookingDate,
  bookingTime = null,
  approvedBy,
  reason = null,
}) {
  const { data, error } = await supabase.rpc('booking_record_category_capacity_override', {
    p_business_id: businessId,
    p_booking_type_id: bookingTypeId,
    p_booking_date: bookingDate,
    p_booking_time: bookingTime ? normalizeTimeForDb(bookingTime) : null,
    p_approved_by: approvedBy,
    p_reason: reason || null,
  });
  if (error) throw error;
  return data && typeof data === 'object' ? data : {};
}

export async function approveCategoryCapacityOverride(businessId, pin, {
  bookingTypeId,
  bookingDate,
  bookingTime = null,
  reason = null,
}) {
  const result = await validateAnyManagerPin(businessId, pin);
  if (!result.ok) {
    throw new Error('Invalid manager PIN');
  }

  const recorded = await recordCategoryCapacityOverride({
    businessId,
    bookingTypeId,
    bookingDate,
    bookingTime,
    approvedBy: result.managerId,
    reason,
  });

  if (!recorded?.ok) {
    throw new Error(recorded?.message || 'Could not record capacity override');
  }

  return {
    approvedBy: result.managerId,
    managerName: result.managerName,
    overrideId: recorded.override_id,
  };
}

/** Estimate booking units for capacity checks. */
export function estimateBookingCapacityUnits({
  participants = [],
  typeKey = '',
  fallbackCount = 1,
}) {
  if (activityCountsAllParticipantsByType(typeKey)) {
    return Math.max(1, participants?.length || fallbackCount);
  }
  if (activityCountsCampersByType(typeKey)) {
    if (participants?.length) {
      const camperCount = participants.filter((p) => participantCountsTowardCapacity({
        party_role: p.party_role || p.partyRole,
        waiver_participants: p.waiver_participants || (p.participant_type
          ? { participant_type: p.participant_type }
          : null),
        is_minor: p.is_minor ?? p.isMinor,
      })).length;
      return Math.max(1, camperCount);
    }
    return Math.max(1, fallbackCount);
  }
  return 1;
}

export function effectiveSpacesLeftFromCapacityContext(ctx, slotOccupied = 0) {
  if (!ctx || typeof ctx !== 'object') return null;
  if (ctx.effective_remaining != null) {
    return Math.max(0, Number.parseInt(ctx.effective_remaining, 10) || 0);
  }
  const slotSpaces = Number.parseInt(ctx.slot_spaces, 10) || 0;
  const occupied = Number.parseInt(ctx.slot_occupied, 10);
  const slotOccupiedSafe = Number.isFinite(occupied) ? occupied : slotOccupied;
  let remaining = Math.max(0, slotSpaces - slotOccupiedSafe);
  if (ctx.category_remaining != null && ctx.category_enabled) {
    remaining = Math.min(remaining, Math.max(0, Number.parseInt(ctx.category_remaining, 10) || 0));
  }
  return remaining;
}
