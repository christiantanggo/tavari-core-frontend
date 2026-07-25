import {
  getDayKeyFromDateString,
  parseTimeToMinutes,
  formatMinutesAsDisplay,
} from './operatingHoursTimeOptions';
import {
  getSpecialHoursForDate,
  isBusinessClosedOnDate,
  normalizeHolidayDateKey,
} from '../../utils/businessSpecialHours';
import { normalizeBookingScheduleTime } from './bookingActivityScheduleHelpers';

export function getEffectiveBusinessHoursForDate(operatingHours, holidayHours, dateStr) {
  const date = normalizeHolidayDateKey(dateStr);
  if (!date) {
    return { closed: true, openMinutes: null, closeMinutes: null, label: null, source: 'invalid' };
  }

  const holidayEntry = getSpecialHoursForDate(holidayHours, date);
  if (holidayEntry?.closed) {
    return {
      closed: true,
      openMinutes: null,
      closeMinutes: null,
      label: holidayEntry.label || date,
      source: 'holiday',
      hoursText: 'Closed',
    };
  }

  if (holidayEntry && !holidayEntry.closed) {
    const row = (holidayHours || []).find(
      (entry) => entry && normalizeHolidayDateKey(entry.date) === date,
    );
    const open = typeof row?.hours?.open === 'string' ? row.hours.open.trim() : '';
    const close = typeof row?.hours?.close === 'string' ? row.hours.close.trim() : '';
    const openMinutes = parseTimeToMinutes(open);
    const closeMinutes = parseTimeToMinutes(close);
    if (openMinutes == null || closeMinutes == null || closeMinutes <= openMinutes) {
      return {
        closed: true,
        openMinutes: null,
        closeMinutes: null,
        label: holidayEntry.label || date,
        source: 'holiday',
        hoursText: holidayEntry.hoursText,
      };
    }
    return {
      closed: false,
      openMinutes,
      closeMinutes,
      label: holidayEntry.label || date,
      source: 'holiday',
      hoursText: holidayEntry.hoursText,
    };
  }

  const dayKey = getDayKeyFromDateString(date);
  const day = operatingHours?.[dayKey];
  if (!day || day.closed) {
    return {
      closed: true,
      openMinutes: null,
      closeMinutes: null,
      label: dayKey,
      source: 'regular',
      hoursText: 'Closed',
    };
  }

  const openMinutes = parseTimeToMinutes(day.open);
  const closeMinutes = parseTimeToMinutes(day.close);
  if (openMinutes == null || closeMinutes == null || closeMinutes <= openMinutes) {
    return {
      closed: true,
      openMinutes: null,
      closeMinutes: null,
      label: dayKey,
      source: 'regular',
      hoursText: 'Closed',
    };
  }

  return {
    closed: false,
    openMinutes,
    closeMinutes,
    label: dayKey,
    source: 'regular',
    hoursText: `${formatMinutesAsDisplay(openMinutes)} - ${formatMinutesAsDisplay(closeMinutes)}`,
  };
}

export function validateBookingWithinBusinessHours({
  bookingDate,
  bookingTime,
  durationMinutes = 60,
  operatingHours,
  holidayHours,
}) {
  const dateStr = normalizeHolidayDateKey(bookingDate);
  const normalizedTime = normalizeBookingScheduleTime(bookingTime);
  // durationMinutes kept for call-site compatibility; open/close window is not enforced.
  void durationMinutes;

  if (!dateStr || !normalizedTime) {
    return { ok: false, requiresOverride: false, message: 'Booking date and time are required.' };
  }

  const effective = getEffectiveBusinessHoursForDate(operatingHours, holidayHours, dateStr);
  if (effective.closed) {
    const label = effective.label || dateStr;
    return {
      ok: false,
      requiresOverride: true,
      message: effective.source === 'holiday'
        ? `We are closed on ${label}. Choose another date or request a manager override.`
        : 'We are closed on this day. Choose another date or request a manager override.',
      effective,
    };
  }

  // Published schedules (e.g. day camp at 8:30) may start before / end after general
  // operating hours. Only fully closed days (holiday system) block bookings here;
  // booking settings gate visibility/availability separately.
  const startMinutes = parseTimeToMinutes(normalizedTime);
  if (startMinutes == null) {
    return { ok: false, requiresOverride: false, message: 'Invalid booking time.' };
  }

  return { ok: true, effective };
}

export function isDateClosedForBookings(operatingHours, holidayHours, dateStr) {
  if (isBusinessClosedOnDate(holidayHours, dateStr)) return true;
  const effective = getEffectiveBusinessHoursForDate(operatingHours, holidayHours, dateStr);
  return effective.closed;
}

export function filterActivitySchedulesWithinBusinessHours(
  schedules,
  dateStr,
  durationMinutes,
  operatingHours,
  holidayHours,
) {
  return (schedules || []).filter((schedule) => {
    const check = validateBookingWithinBusinessHours({
      bookingDate: dateStr,
      bookingTime: schedule?.start_time,
      durationMinutes,
      operatingHours,
      holidayHours,
    });
    return check.ok;
  });
}
