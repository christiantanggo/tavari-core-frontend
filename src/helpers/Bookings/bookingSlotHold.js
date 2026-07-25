import { supabase } from '../../supabaseClient';
import { normalizeBookingScheduleTime } from './bookingActivityScheduleHelpers';

export const PORTAL_SLOT_OCCUPANCY_POLL_MS = 12 * 1000;

export const BOOKING_SLOT_HOLD_MAX_SECONDS = 10 * 60;
export const BOOKING_SLOT_HOLD_IDLE_SECONDS = 2 * 60;
export const BOOKING_SLOT_HOLD_HEARTBEAT_MS = 30 * 1000;
export const BOOKING_SLOT_HOLD_TOUCH_THROTTLE_MS = 15 * 1000;

export function bookingSlotHoldStorageKey(businessId, activityId) {
  return `booking-portal-slot-hold-${businessId}-${activityId}`;
}

export function getOrCreateSlotHoldToken(businessId, activityId) {
  const key = bookingSlotHoldStorageKey(businessId, activityId);
  try {
    const existing = sessionStorage.getItem(key);
    if (existing && typeof existing === 'string' && existing.trim()) {
      return existing.trim();
    }
    const token =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `hold_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(key, token);
    return token;
  } catch {
    return `hold_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function clearSlotHoldToken(businessId, activityId) {
  try {
    sessionStorage.removeItem(bookingSlotHoldStorageKey(businessId, activityId));
  } catch {
    /* ignore */
  }
}

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

export async function acquireBookingSlotHold({
  businessId,
  activityId,
  bookingDate,
  bookingTime,
  holdToken,
  customerId = null,
}) {
  const { data, error } = await supabase.rpc('booking_acquire_slot_hold', {
    p_business_id: businessId,
    p_activity_id: activityId,
    p_booking_date: bookingDate,
    p_booking_time: normalizeTimeForDb(bookingTime),
    p_hold_token: holdToken,
    p_customer_id: customerId || null,
    p_spaces_requested: 1,
  });
  if (error) throw error;
  return data;
}

export async function touchBookingSlotHold(holdToken) {
  if (!holdToken) return { ok: false, message: 'Missing hold token.' };
  const { data, error } = await supabase.rpc('booking_touch_slot_hold', {
    p_hold_token: holdToken,
  });
  if (error) throw error;
  return data;
}

export async function releaseBookingSlotHold(holdToken) {
  if (!holdToken) return { ok: true };
  const { data, error } = await supabase.rpc('booking_release_slot_hold', {
    p_hold_token: holdToken,
  });
  if (error) throw error;
  return data;
}

export async function fetchPortalSlotOccupancy({
  businessId,
  activityId,
  bookingDate,
  excludeHoldToken = null,
}) {
  const { data, error } = await supabase.rpc('booking_get_portal_slot_occupancy', {
    p_business_id: businessId,
    p_activity_id: activityId,
    p_booking_date: bookingDate,
    p_exclude_hold_token: excludeHoldToken || null,
  });
  if (error) throw error;
  return data && typeof data === 'object' ? data : {};
}

/** Active bookings + resource assignments for a date (cross-package room conflicts). */
export async function fetchDayResourceOccupancy({ businessId, bookingDate }) {
  const { data, error } = await supabase.rpc('booking_list_day_resource_occupancy', {
    p_business_id: businessId,
    p_booking_date: bookingDate,
  });
  if (error) throw error;
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* ignore */
    }
  }
  return [];
}

/** Match portal schedule start_time to occupancy map keys from the database. */
export function resolvePortalSlotOccupancyCount(occupancy, startTime) {
  if (!occupancy || typeof occupancy !== 'object') return 0;
  const normalized = normalizeBookingScheduleTime(startTime);
  const candidates = [
    normalized,
    normalized ? `${normalized}:00` : '',
    String(startTime || '').trim(),
  ].filter(Boolean);
  for (const key of candidates) {
    if (occupancy[key] == null) continue;
    return Math.max(0, Number.parseInt(occupancy[key], 10) || 0);
  }
  return 0;
}

export function getPortalSlotCapacity(schedule) {
  if (schedule?.spaces != null && Number.isFinite(Number(schedule.spaces))) {
    return Math.max(0, Number(schedule.spaces));
  }
  return 1;
}

export function getPortalSlotSpacesLeft(schedule, occupiedCount = 0) {
  const total = getPortalSlotCapacity(schedule);
  const occupied = Math.max(0, Number.parseInt(occupiedCount, 10) || 0);
  return Math.max(0, total - occupied);
}

export function formatSlotHoldCountdown(secondsRemaining) {
  const safe = Math.max(0, Number.parseInt(secondsRemaining, 10) || 0);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
