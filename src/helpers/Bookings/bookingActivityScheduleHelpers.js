import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { flattenScheduleResourceAssignments } from '../../utils/bookingTimeRange';
import {
  parseScheduleCategoryAssignment,
  serializeScheduleCategoryAssignment,
  SCHEDULE_RESOURCE_MODES,
} from './bookingScheduleResourceRequirements';
import { areRequiredResourcesAvailableForSlot } from './bookingResourceAvailability';

dayjs.extend(utc);
dayjs.extend(timezone);

export function normalizeBookingScheduleTime(timeValue) {
  if (!timeValue) return '';
  const raw = String(timeValue).trim();
  // Prefer explicit AM/PM parse so "6:00 PM" never becomes 06:00.
  const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampm) {
    let hour = Number.parseInt(ampm[1], 10);
    const minute = Number.parseInt(ampm[2], 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
    const suffix = ampm[3].toUpperCase();
    if (suffix === 'AM') {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) return raw.substring(0, 5);
  const parsed = dayjs(`1970-01-01 ${raw}`, { strict: false });
  return parsed.isValid() ? parsed.format('HH:mm') : raw.substring(0, 5);
}

export function formatBookingScheduleTimeDisplay(timeValue) {
  const normalized = normalizeBookingScheduleTime(timeValue);
  if (!normalized) return '';
  const [hourPart, minutePart] = normalized.split(':');
  const hour = Number(hourPart);
  if (!Number.isFinite(hour) || !minutePart) return String(timeValue);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutePart} ${suffix}`;
}

export function scheduleSlotTotalSpaces(schedule) {
  const spaces = Number(schedule?.spaces);
  return Number.isFinite(spaces) && spaces > 0 ? spaces : 1;
}

/**
 * Multiple schedule rows at the same start time (e.g. one row per required room) represent
 * one bookable slot with combined resources — not separate capacity per row.
 */
export function dedupeSchedulesByStartTime(schedules = []) {
  const byTime = new Map();

  (schedules || []).forEach((schedule) => {
    const key = normalizeBookingScheduleTime(schedule?.start_time);
    if (!key) return;

    const existing = byTime.get(key);
    if (!existing) {
      byTime.set(key, { ...schedule });
      return;
    }

    const spaces = Math.max(
      scheduleSlotTotalSpaces(existing),
      scheduleSlotTotalSpaces(schedule),
    );

    const mergedResources = mergeScheduleResourceAssignments([
      { resource_assignments: existing.resource_assignments || {} },
      { resource_assignments: schedule.resource_assignments || {} },
    ]);

    byTime.set(key, {
      ...existing,
      ...schedule,
      spaces,
      resource_assignments: mergedResources,
    });
  });

  return Array.from(byTime.values()).sort((a, b) => {
    const aTime = normalizeBookingScheduleTime(a.start_time);
    const bTime = normalizeBookingScheduleTime(b.start_time);
    return aTime.localeCompare(bTime);
  });
}

/** Postgres `date` values must not be timezone-shifted via dayjs local parse. */
function scheduleDateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Prefer UTC components for Date objects that originated as date-only midnight UTC.
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function pickSchedulesForActivityOnDate(schedules, date, businessTimezone) {
  if (!date || !Array.isArray(schedules) || schedules.length === 0) return [];

  const dayOfWeek = dayjs(date).tz(businessTimezone).day();
  const dateStr = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
  const byDay = schedules.filter((schedule) => Number(schedule.day_of_week) === dayOfWeek);

  const dateSpecific = [];
  const indefinite = [];

  byDay.forEach((schedule) => {
    const hasRange = schedule.start_date || schedule.end_date;
    if (!hasRange) {
      indefinite.push(schedule);
      return;
    }

    const start = scheduleDateOnly(schedule.start_date);
    const end = scheduleDateOnly(schedule.end_date);

    if (start && end && dateStr >= start && dateStr <= end) {
      dateSpecific.push(schedule);
    } else if (start && !end && dateStr >= start) {
      dateSpecific.push(schedule);
    } else if (!start && end && dateStr <= end) {
      dateSpecific.push(schedule);
    }
  });

  const use = dateSpecific.length > 0 ? dateSpecific : indefinite;

  return use.slice().sort((a, b) => {
    const aTime = normalizeBookingScheduleTime(a.start_time);
    const bTime = normalizeBookingScheduleTime(b.start_time);
    return aTime.localeCompare(bTime);
  });
}

/** True when every schedule row is a one-off date (start_date === end_date), not a weekly pattern. */
export function isIndividualDatesSchedule(schedules = []) {
  if (!Array.isArray(schedules) || schedules.length === 0) return false;
  return schedules.every((schedule) => {
    const start = scheduleDateOnly(schedule.start_date);
    const end = scheduleDateOnly(schedule.end_date);
    return Boolean(start && end && start === end);
  });
}

/**
 * Unique specific dates from an individual-dates schedule, sorted ascending.
 * Optional filters: todayStr (YYYY-MM-DD), latestAllowedDateStr, isDateClosed(dateStr).
 */
export function listIndividualScheduleDateKeys(
  schedules = [],
  {
    todayStr = null,
    latestAllowedDateStr = null,
    isDateClosed = null,
  } = {},
) {
  if (!isIndividualDatesSchedule(schedules)) return [];

  const keys = new Set();
  for (const schedule of schedules) {
    const start = scheduleDateOnly(schedule.start_date);
    if (!start) continue;
    if (todayStr && start < todayStr) continue;
    if (latestAllowedDateStr && start > latestAllowedDateStr) continue;
    if (typeof isDateClosed === 'function' && isDateClosed(start)) continue;
    keys.add(start);
  }

  return [...keys].sort();
}

export async function fetchActivitySchedules(client, businessId, activityId) {
  const { data, error } = await client
    .from('booking_activity_schedules')
    .select('id, activity_id, day_of_week, start_time, start_date, end_date, spaces, is_active, resource_assignments, schedule_name')
    .eq('business_id', businessId)
    .eq('activity_id', activityId)
    .eq('is_active', true);

  if (error) throw error;
  return data || [];
}

export {
  MULTI_DAY_SCHEDULE_PREFIX,
  isMultiDayScheduleName,
  isMultiDayEventSchedule,
  isMultiDayScheduleRow,
  groupMultiDaySeries,
  listMultiDaySeriesPortalEntries,
  listMultiDayAnchorPortalEntriesFromConfig,
  shouldUseMultiDayPortalListing,
  buildMultiDayScheduleName,
  stripMultiDaySchedulePrefix,
  buildMultiDayTicketSettingsFromDates,
  listWeekdayRunFromStart,
  listSelectedDaysInWeekOf,
  splitDateKeysIntoWeekRuns,
  buildMultiDayWeekScheduleName,
  parseMultiDaySeasonLabel,
} from './bookingMultiDaySchedule';


export function getCalendarDaysForMonth(baseDate, businessTimezone) {
  const first = dayjs(baseDate).tz(businessTimezone).startOf('month');
  const daysInMonth = first.daysInMonth();
  const startPad = first.day();
  const days = [];

  for (let i = 0; i < startPad; i += 1) {
    days.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(first.date(day).toDate());
  }

  return days;
}

export function getBusinessTodayDateKey(businessTimezone) {
  return dayjs().tz(businessTimezone).startOf('day').format('YYYY-MM-DD');
}

export function isBookingDateInPast(dateKey, businessTimezone) {
  if (!dateKey) return false;
  return dateKey < getBusinessTodayDateKey(businessTimezone);
}

export function getAvailableDatesInMonth(
  schedules,
  monthBaseDate,
  businessTimezone,
  includeDateKeys = [],
) {
  const todayStr = getBusinessTodayDateKey(businessTimezone);
  const keys = new Set(
    (includeDateKeys || []).filter((dateKey) => dateKey && dateKey >= todayStr),
  );
  if (!Array.isArray(schedules) || schedules.length === 0) return keys;

  const first = dayjs(monthBaseDate).tz(businessTimezone).startOf('month');
  const last = first.endOf('month');

  for (
    let cursor = first;
    cursor.isBefore(last) || cursor.isSame(last, 'day');
    cursor = cursor.add(1, 'day')
  ) {
    const dateKey = cursor.format('YYYY-MM-DD');
    if (dateKey < todayStr) continue;

    const slots = pickSchedulesForActivityOnDate(schedules, cursor.toDate(), businessTimezone);
    if (slots.length > 0) {
      keys.add(dateKey);
    }
  }

  return keys;
}

import { isMultiDayParentBooking, shouldHideFromScheduleSlot } from './bookingMultiDay';
import { countAllParticipantsOnBooking, countCapacityParticipantsOnBooking } from './bookingCapacity';

export const ACTIVE_BOOKING_STATUSES_FOR_CAPACITY = ['pending', 'confirmed', 'checked_in'];

/** Day camp: campers/children only — one seat per qualifying participant. */
export const CAMPER_CAPACITY_TYPE_KEYS = new Set(['day_camp']);

/** Drop-in play: every attendee (adult + child) consumes one schedule seat. */
export const ALL_PARTICIPANT_CAPACITY_TYPE_KEYS = new Set(['drop_in_play']);

/** @deprecated use CAMPER_CAPACITY_TYPE_KEYS or ALL_PARTICIPANT_CAPACITY_TYPE_KEYS */
export const PARTICIPANT_BASED_CAPACITY_TYPE_KEYS = new Set([
  ...CAMPER_CAPACITY_TYPE_KEYS,
  ...ALL_PARTICIPANT_CAPACITY_TYPE_KEYS,
]);

export function activityCountsCampersByType(typeKey) {
  return CAMPER_CAPACITY_TYPE_KEYS.has(typeKey);
}

export function activityCountsAllParticipantsByType(typeKey) {
  return ALL_PARTICIPANT_CAPACITY_TYPE_KEYS.has(typeKey);
}

export function activityCountsParticipantsByType(typeKey) {
  return activityCountsCampersByType(typeKey) || activityCountsAllParticipantsByType(typeKey);
}

export function activityUsesParticipantCapacity(typeKey) {
  return activityCountsParticipantsByType(typeKey);
}

export function resolveBookingParticipantCount(booking, parentBookingsById = null, typeKey = '') {
  if (activityCountsAllParticipantsByType(typeKey)) {
    return countAllParticipantsOnBooking(booking, parentBookingsById);
  }
  return countCapacityParticipantsOnBooking(booking, parentBookingsById);
}

export function bookingOccupancyUnits(
  booking,
  { countByParticipants = false, countAllParticipants = false, typeKey = '', parentBookingsById = null } = {},
) {
  if (shouldHideFromScheduleSlot(booking)) return 0;

  const resolvedTypeKey = typeKey || booking?.booking_types?.type_key || '';
  const useAllParticipants =
    countAllParticipants || activityCountsAllParticipantsByType(resolvedTypeKey);
  const useCamperParticipants =
    countByParticipants || activityCountsCampersByType(resolvedTypeKey);

  if (useAllParticipants) {
    return Math.max(1, countAllParticipantsOnBooking(booking, parentBookingsById));
  }
  if (useCamperParticipants) {
    return countCapacityParticipantsOnBooking(booking, parentBookingsById);
  }
  return 1;
}

export function countBookingsPerSlotTime(
  bookings = [],
  { excludeBookingId = null, countByParticipants = false, countAllParticipants = false, typeKey = '', parentBookingsById = null } = {},
) {
  const byTime = {};
  (bookings || []).forEach((booking) => {
    if (!booking) return;
    if (excludeBookingId && booking.id === excludeBookingId) return;
    if (shouldHideFromScheduleSlot(booking)) return;
    if (!ACTIVE_BOOKING_STATUSES_FOR_CAPACITY.includes(booking.status)) return;
    const key = normalizeBookingScheduleTime(booking.booking_time);
    if (!key) return;
    byTime[key] = (byTime[key] || 0) + bookingOccupancyUnits(booking, {
      countByParticipants,
      countAllParticipants,
      typeKey,
      parentBookingsById,
    });
  });
  return byTime;
}

export function scheduleSlotSpacesLeft(schedule, bookedCount = 0) {
  const total = scheduleSlotTotalSpaces(schedule);
  return Math.max(0, total - bookedCount);
}

export function isScheduleSlotAvailable(schedule, bookedCount = 0) {
  return scheduleSlotSpacesLeft(schedule, bookedCount) > 0;
}

export function buildScheduleTimeOptions(schedules, date, businessTimezone, currentTimeValue = '') {
  const targetDate = date
    ? dayjs.tz(date, businessTimezone).toDate()
    : null;
  const rawSlots = targetDate
    ? pickSchedulesForActivityOnDate(schedules, targetDate, businessTimezone)
    : [];
  const slots = dedupeSchedulesByStartTime(rawSlots);

  const options = slots.map((schedule) => ({
    value: normalizeBookingScheduleTime(schedule.start_time),
    label: formatBookingScheduleTimeDisplay(schedule.start_time),
    schedule,
  }));

  const normalizedCurrent = normalizeBookingScheduleTime(currentTimeValue);
  if (normalizedCurrent && !options.some((option) => option.value === normalizedCurrent)) {
    options.unshift({
      value: normalizedCurrent,
      label: `${formatBookingScheduleTimeDisplay(normalizedCurrent)} (current)`,
      schedule: null,
    });
  }

  return options.sort((a, b) => a.value.localeCompare(b.value));
}

export function buildScheduleTimeOptionsWithCapacity(
  schedules,
  date,
  businessTimezone,
  {
    currentTimeValue = '',
    bookedCountsByTime = {},
    resourceSlotContext = null,
  } = {},
) {
  return buildScheduleTimeOptions(schedules, date, businessTimezone, currentTimeValue)
    .map((option) => {
      if (!option.schedule) {
        return { ...option, disabled: false, spacesLeft: null, resourceBlocked: false };
      }

      const booked = bookedCountsByTime[option.value] || 0;
      const spacesLeft = scheduleSlotSpacesLeft(option.schedule, booked);
      let resourceBlocked = false;

      if (resourceSlotContext) {
        const resourceCheck = areRequiredResourcesAvailableForSlot({
          schedule: option.schedule,
          categoryId: resourceSlotContext.categoryId,
          bookingDate: resourceSlotContext.bookingDate,
          bookingTime: option.value,
          durationMinutes: resourceSlotContext.durationMinutes,
          dayBookings: resourceSlotContext.dayBookings,
          excludeBookingId: resourceSlotContext.excludeBookingId,
          resourcePaddingById: resourceSlotContext.resourcePaddingById,
          resourceQuantityById: resourceSlotContext.resourceQuantityById,
        });
        resourceBlocked = !resourceCheck.ok;
      }

      const slotAvailable = spacesLeft > 0;
      const available = slotAvailable && !resourceBlocked;

      let label = option.label;
      if (!available) {
        if (resourceBlocked && slotAvailable) {
          label = `${option.label} (room unavailable)`;
        } else if (!slotAvailable) {
          label = `${option.label} (full)`;
        } else {
          label = `${option.label} (unavailable)`;
        }
      }

      return {
        ...option,
        disabled: !available,
        spacesLeft,
        resourceBlocked,
        label,
      };
    });
}

export function validateScheduleSlotSelection({
  schedules,
  bookingDate,
  bookingTime,
  businessTimezone,
  bookedCountsByTime = {},
} = {}) {
  const normalizedTime = normalizeBookingScheduleTime(bookingTime);
  if (!bookingDate || !normalizedTime) {
    return { ok: false, message: 'Activity, date, and time are required' };
  }

  const matches = dedupeSchedulesByStartTime(
    findMatchingScheduleSlots(schedules, bookingDate, normalizedTime, businessTimezone),
  );
  if (matches.length === 0) {
    return { ok: true };
  }

  const booked = bookedCountsByTime[normalizedTime] || 0;
  const schedule = matches[0];
  if (!isScheduleSlotAvailable(schedule, booked)) {
    return {
      ok: false,
      message: 'This time slot is already full. Choose another time to avoid a double booking.',
    };
  }

  return { ok: true };
}

export function mergeScheduleResourceAssignments(schedules = []) {
  const merged = {};
  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    const resourceAssignments = schedule?.resource_assignments;
    if (!resourceAssignments || typeof resourceAssignments !== 'object') return;

    Object.entries(resourceAssignments).forEach(([categoryId, value]) => {
      const incoming = parseScheduleCategoryAssignment(value);
      const existingRaw = merged[categoryId];
      if (!existingRaw) {
        const serialized = serializeScheduleCategoryAssignment(incoming);
        if (serialized != null) merged[categoryId] = serialized;
        return;
      }

      const existing = parseScheduleCategoryAssignment(existingRaw);
      // Pool + fixed in same merge: keep the stricter / richer requirement.
      if (
        incoming.mode === SCHEDULE_RESOURCE_MODES.POOL ||
        existing.mode === SCHEDULE_RESOURCE_MODES.POOL
      ) {
        const pool = [...new Set([...(existing.pool || []), ...(incoming.pool || [])])];
        const count = Math.max(existing.count || 0, incoming.count || 0, 1);
        merged[categoryId] = {
          mode: SCHEDULE_RESOURCE_MODES.POOL,
          count: Math.min(count, pool.length || count),
          pool,
        };
        return;
      }

      const resourceIds = [...new Set([
        ...(existing.resourceIds || []),
        ...(incoming.resourceIds || []),
      ])];
      merged[categoryId] = resourceIds;
    });
  });
  return merged;
}

export function findMatchingScheduleSlots(
  schedules,
  bookingDate,
  bookingTime,
  businessTimezone,
) {
  if (!bookingDate || !bookingTime) return [];

  const date = dayjs.tz(bookingDate, businessTimezone).toDate();
  const daySchedules = pickSchedulesForActivityOnDate(schedules, date, businessTimezone);
  const targetTime = normalizeBookingScheduleTime(bookingTime);

  return daySchedules.filter(
    (schedule) => normalizeBookingScheduleTime(schedule.start_time) === targetTime,
  );
}

export function resolveFlatResourceAssignmentsFromSchedule(
  schedules,
  bookingDate,
  bookingTime,
  businessTimezone,
) {
  const matches = findMatchingScheduleSlots(
    schedules,
    bookingDate,
    bookingTime,
    businessTimezone,
  );
  const merged = mergeScheduleResourceAssignments(matches);
  return flattenScheduleResourceAssignments(merged);
}
