import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  formatMinutesAs24Hour,
  formatMinutesAsDisplay,
  parseTimeToMinutes
} from '../helpers/Bookings/operatingHoursTimeOptions';

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_TZ = 'America/Toronto';

export const resolveBusinessTimezone = (tz) => (tz && String(tz).trim()) || DEFAULT_TZ;

export const getBusinessToday = (tz = DEFAULT_TZ) => dayjs().tz(resolveBusinessTimezone(tz)).format('YYYY-MM-DD');

/** Merge RPC schedule_times + linked task templates; return sorted unique HH:mm values. */
export const normalizeFormScheduleTimes = (payloadOrTimes) => {
  const raw = [];

  if (Array.isArray(payloadOrTimes)) {
    raw.push(...payloadOrTimes);
  } else if (payloadOrTimes && typeof payloadOrTimes === 'object') {
    if (Array.isArray(payloadOrTimes.schedule_times)) {
      raw.push(...payloadOrTimes.schedule_times);
    }
    if (Array.isArray(payloadOrTimes.linked_templates)) {
      payloadOrTimes.linked_templates.forEach((template) => {
        if (Array.isArray(template?.schedule_times)) {
          raw.push(...template.schedule_times);
        }
      });
    }
  }

  const seen = new Set();
  const normalized = [];

  raw.forEach((time) => {
    const minutes = parseTimeToMinutes(time);
    if (minutes == null) return;
    const value = formatMinutesAs24Hour(minutes);
    if (seen.has(value)) return;
    seen.add(value);
    normalized.push(value);
  });

  return normalized.sort((a, b) => (parseTimeToMinutes(a) ?? 0) - (parseTimeToMinutes(b) ?? 0));
};

export const formatScheduleSlotLabel = (time) => {
  const minutes = parseTimeToMinutes(time);
  if (minutes == null) return String(time || '');
  return formatMinutesAsDisplay(minutes);
};

export const isFutureBusinessSlot = (date, time, tz = DEFAULT_TZ) => {
  if (!date || !time) return false;
  const zone = resolveBusinessTimezone(tz);
  const slot = dayjs.tz(`${date} ${String(time).slice(0, 5)}`, 'YYYY-MM-DD HH:mm', zone);
  if (!slot.isValid()) return false;
  return slot.isAfter(dayjs().tz(zone));
};

export const businessSlotToDayjs = (date, time, tz = DEFAULT_TZ) => {
  if (!date || !time) return null;
  const zone = resolveBusinessTimezone(tz);
  const slot = dayjs.tz(`${date} ${String(time).slice(0, 5)}`, 'YYYY-MM-DD HH:mm', zone);
  return slot.isValid() ? slot : null;
};

export const businessSlotToIso = (date, time, tz = DEFAULT_TZ) => {
  const slot = businessSlotToDayjs(date, time, tz);
  return slot ? slot.toISOString() : null;
};

/** Prefer RPC scheduled_for; fall back to date + time in business timezone. */
export const resolveFormScheduledFor = (session, tz = DEFAULT_TZ) => {
  if (session?.scheduledFor) return session.scheduledFor;
  return businessSlotToIso(session?.scheduledDate, session?.scheduledTime, tz);
};

export const getBusinessDateFromIso = (iso, tz = DEFAULT_TZ) => {
  if (!iso) return '';
  const value = dayjs(iso);
  if (!value.isValid()) return '';
  return value.tz(resolveBusinessTimezone(tz)).format('YYYY-MM-DD');
};

export const getBusinessMinutesFromIso = (iso, tz = DEFAULT_TZ) => {
  if (!iso) return null;
  const value = dayjs(iso);
  if (!value.isValid()) return null;
  const local = value.tz(resolveBusinessTimezone(tz));
  return local.hour() * 60 + local.minute();
};

export const getBusinessDayUtcRange = (date, tz = DEFAULT_TZ) => {
  const zone = resolveBusinessTimezone(tz);
  const start = dayjs.tz(date, 'YYYY-MM-DD', zone).startOf('day');
  return {
    startUtc: start.toISOString(),
    endUtc: start.add(1, 'day').toISOString()
  };
};

export const isBusinessSlotExpired = (date, time, dueWindowMinutes = 60, tz = DEFAULT_TZ) => {
  const slot = businessSlotToDayjs(date, time, tz);
  if (!slot) return false;
  return dayjs().tz(resolveBusinessTimezone(tz)).isAfter(slot.add(Number(dueWindowMinutes) || 60, 'minute'));
};

export const filterScheduleTimesForDate = (times = [], date, tz = DEFAULT_TZ) => {
  const zone = resolveBusinessTimezone(tz);
  const today = getBusinessToday(zone);
  if (date !== today) return times;
  const now = dayjs().tz(zone);
  return times.filter((time) => {
    const [hour, minute] = String(time).slice(0, 5).split(':').map(Number);
    if (Number.isNaN(hour)) return false;
    const slot = dayjs.tz(date, zone).hour(hour).minute(Number.isNaN(minute) ? 0 : minute).second(0);
    return !slot.isAfter(now);
  });
};

export const maxBusinessTimeForDate = (date, tz = DEFAULT_TZ) => {
  const zone = resolveBusinessTimezone(tz);
  if (date !== getBusinessToday(zone)) return null;
  return dayjs().tz(zone).format('HH:mm');
};
