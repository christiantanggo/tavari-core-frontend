/**
 * Task due scheduling (aligned with Tavari Reminder schedule types).
 * Mirrors supabase/functions/_shared/reminderSchedule.ts for client-side due_at computation.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export function resolveTaskTimezone(timeZone) {
  const tz = String(timeZone || '').trim();
  return tz || 'America/Toronto';
}

export function parseStoredTimestamp(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const fromDate = new Date(raw);
  if (!Number.isNaN(fromDate.getTime())) {
    return dayjs(fromDate);
  }
  let normalized = raw.replace(' ', 'T').replace(/\+00$/, '+00:00');
  const parsed = dayjs(normalized);
  return parsed.isValid() ? parsed : null;
}

export const TASK_WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' }
];

export const TASK_WEEK_OF_MONTH = [
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' },
  { value: 5, label: 'Last' }
];

export const TASK_SCHEDULE_TYPES = [
  { value: 'once', label: 'One time' },
  { value: 'daily', label: 'Daily (every day)' },
  { value: 'weekly', label: 'Weekly (every week)' },
  { value: 'biweekly', label: 'Bi-weekly (every 2 weeks)' },
  { value: 'monthly', label: 'Monthly (day of month)' },
  { value: 'monthly_weekday', label: 'Monthly (e.g. first Monday)' }
];

export const KIOSK_CHECKLIST_SCHEDULE_MODE = 'kiosk_checklist';
export const TODAY_PRIORITY_SCHEDULE_MODE = 'today_priority';

export const TASK_DUE_SCHEDULE_MODES = [
  { value: 'daily_required', label: 'Daily required at a set time' },
  { value: 'specific_date', label: 'One-off for a specific date & time' },
  { value: 'frequency', label: 'Recurring frequency' },
  { value: 'round_robin', label: 'Round robin list' },
  { value: 'weekly_round_robin', label: 'Weekly round robin (carryover + Sunday refresh)' },
  { value: 'biweekly_round_robin', label: 'Bi-weekly round robin (carryover + every 2 weeks)' }
];

export const PERIOD_ROUND_ROBIN_MODES = ['weekly_round_robin', 'biweekly_round_robin'];

export const ROUND_ROBIN_RESET_CADENCE = {
  on_complete: 'on_complete',
  weekly_sunday: 'weekly_sunday',
  biweekly_sunday: 'biweekly_sunday'
};

export function isPeriodRoundRobinMode(mode) {
  return PERIOD_ROUND_ROBIN_MODES.includes(mode);
}

export function roundRobinResetCadenceForMode(mode) {
  if (mode === 'weekly_round_robin') return ROUND_ROBIN_RESET_CADENCE.weekly_sunday;
  if (mode === 'biweekly_round_robin') return ROUND_ROBIN_RESET_CADENCE.biweekly_sunday;
  return ROUND_ROBIN_RESET_CADENCE.on_complete;
}

export function roundRobinGroupsForMode(groups = [], mode) {
  const cadence = roundRobinResetCadenceForMode(mode);
  return groups.filter((group) => (group.reset_cadence || ROUND_ROBIN_RESET_CADENCE.on_complete) === cadence);
}

export function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

export function getDateInTimeZone(date, timeZone) {
  const p = getZonedParts(date, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addDaysToDateString(dateValue, days) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return d.toISOString().slice(0, 10);
}

/** Sunday-based week start in the business timezone (Sunday = 0). */
export function businessWeekStartDate(timeZone = 'America/Toronto') {
  const today = getDateInTimeZone(new Date(), timeZone);
  const [year, month, day] = today.split('-').map(Number);
  const dow = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
  return addDaysToDateString(today, -dow);
}

const BIWEEKLY_PERIOD_ANCHOR = '2024-01-07';

/** Start of the current 2-week period (Sunday), aligned with DB task_manager_business_biweekly_period_start. */
export function businessBiweeklyPeriodStart(timeZone = 'America/Toronto') {
  const weekStart = businessWeekStartDate(timeZone);
  const [wy, wm, wd] = weekStart.split('-').map(Number);
  const [ay, am, ad] = BIWEEKLY_PERIOD_ANCHOR.split('-').map(Number);
  const weekMs = Date.UTC(wy, wm - 1, wd, 12, 0, 0);
  const anchorMs = Date.UTC(ay, am - 1, ad, 12, 0, 0);
  const weeks = Math.floor((weekMs - anchorMs) / (7 * 24 * 60 * 60 * 1000));
  return weeks % 2 === 0 ? weekStart : addDaysToDateString(weekStart, -7);
}

export function zonedDateTimeToUtc(dateValue, timeValue, timeZone) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hour = 0, minute = 0, second = 0] = timeValue.split(':').map(Number);
  const targetTime = Date.UTC(year, month - 1, day, hour, minute, second || 0);
  let candidate = new Date(targetTime);
  for (let i = 0; i < 3; i += 1) {
    const zonedParts = getZonedParts(candidate, timeZone);
    const zonedAsUtc = Date.UTC(
      zonedParts.year,
      zonedParts.month - 1,
      zonedParts.day,
      zonedParts.hour,
      zonedParts.minute,
      zonedParts.second
    );
    candidate = new Date(candidate.getTime() + (targetTime - zonedAsUtc));
  }
  return candidate;
}

export function isWeekendDate(dateValue) {
  const [y, m, d] = dateValue.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return dow === 0 || dow === 6;
}

function dayOfWeekForDate(dateValue) {
  const [y, m, d] = dateValue.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

function firstWeekdayOnOrAfter(fromDate, targetDow) {
  let cursor = fromDate;
  for (let i = 0; i < 370; i += 1) {
    if (dayOfWeekForDate(cursor) === targetDow) return cursor;
    cursor = addDaysToDateString(cursor, 1);
  }
  return fromDate;
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
}

function resolveMonthlyDay(year, month, dayOfMonth) {
  return Math.min(dayOfMonth, lastDayOfMonth(year, month));
}

function resolveNthWeekdayOfMonth(year, month, weekOfMonth, dayOfWeek) {
  const last = lastDayOfMonth(year, month);
  if (weekOfMonth === 5) {
    for (let day = last; day >= 1; day -= 1) {
      if (dayOfWeekForDate(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`) === dayOfWeek) return day;
    }
    return null;
  }
  let seen = 0;
  for (let day = 1; day <= last; day += 1) {
    const dateValue = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (dayOfWeekForDate(dateValue) === dayOfWeek) {
      seen += 1;
      if (seen === weekOfMonth) return day;
    }
  }
  return null;
}

function plannedDateForMonth(schedule, year, month) {
  if (schedule.schedule_type === 'monthly') {
    const dom = schedule.schedule_day_of_month ?? 1;
    const day = resolveMonthlyDay(year, month, dom);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  if (schedule.schedule_type === 'monthly_weekday') {
    const week = schedule.schedule_week_of_month ?? 1;
    const dow = schedule.schedule_day_of_week ?? 1;
    const day = resolveNthWeekdayOfMonth(year, month, week, dow);
    if (day == null) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

function getBiweeklyAnchor(schedule) {
  const targetDow = schedule.schedule_day_of_week ?? 1;
  return firstWeekdayOnOrAfter(schedule.starts_on, targetDow);
}

function nextBiweeklyPlannedDate(schedule, afterDate, minDate) {
  const anchor = getBiweeklyAnchor(schedule);
  const floor = afterDate ? addDaysToDateString(afterDate, 1) : minDate;
  let cursor = anchor;
  while (cursor < floor) {
    cursor = addDaysToDateString(cursor, 14);
  }
  return cursor;
}

function iterateMonthlyCandidates(schedule, startY, startM, maxMonths, predicate) {
  for (let offset = 0; offset < maxMonths; offset += 1) {
    const monthIndex = startM - 1 + offset;
    const year = startY + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const candidate = plannedDateForMonth(schedule, year, month);
    if (candidate && predicate(candidate)) return candidate;
  }
  return null;
}

export function resolveSendDate(startDate, { sendOnWeekends = false } = {}, maxIterations = 400) {
  let cursor = startDate;
  for (let i = 0; i < maxIterations; i += 1) {
    if (!sendOnWeekends && isWeekendDate(cursor)) {
      cursor = addDaysToDateString(cursor, 1);
      continue;
    }
    return cursor;
  }
  return cursor;
}

export function firstPlannedDate(schedule, timeZone) {
  const today = getDateInTimeZone(new Date(), timeZone);
  const start = schedule.starts_on > today ? schedule.starts_on : today;

  if (schedule.schedule_type === 'once') {
    const once = schedule.schedule_once_date;
    if (!once || once < start) return null;
    return once;
  }

  if (schedule.schedule_type === 'daily') {
    return start;
  }

  if (schedule.schedule_type === 'weekly') {
    const targetDow = schedule.schedule_day_of_week ?? 1;
    let cursor = start;
    for (let i = 0; i < 370; i += 1) {
      if (dayOfWeekForDate(cursor) === targetDow) return cursor;
      cursor = addDaysToDateString(cursor, 1);
    }
    return null;
  }

  if (schedule.schedule_type === 'biweekly') {
    return nextBiweeklyPlannedDate(schedule, null, start);
  }

  if (schedule.schedule_type === 'monthly' || schedule.schedule_type === 'monthly_weekday') {
    const [y0, m0] = start.split('-').map(Number);
    return iterateMonthlyCandidates(schedule, y0, m0, 36, (candidate) => candidate >= start);
  }

  return null;
}

export function nextPlannedDate(schedule, afterDate, timeZone) {
  const today = getDateInTimeZone(new Date(), timeZone);
  const start = schedule.starts_on > today ? schedule.starts_on : today;

  if (schedule.schedule_type === 'once') {
    const once = schedule.schedule_once_date;
    if (!once || once <= afterDate) return null;
    if (once < start) return null;
    return once;
  }

  if (schedule.schedule_type === 'daily') {
    const cursor = afterDate < start ? start : addDaysToDateString(afterDate, 1);
    return cursor < start ? start : cursor;
  }

  if (schedule.schedule_type === 'weekly') {
    const targetDow = schedule.schedule_day_of_week ?? 1;
    let cursor = afterDate < start ? start : addDaysToDateString(afterDate, 1);
    for (let i = 0; i < 370; i += 1) {
      if (dayOfWeekForDate(cursor) === targetDow) return cursor;
      cursor = addDaysToDateString(cursor, 1);
    }
    return null;
  }

  if (schedule.schedule_type === 'biweekly') {
    const candidate = nextBiweeklyPlannedDate(schedule, afterDate, start);
    if (candidate < start) return null;
    return candidate;
  }

  if (schedule.schedule_type === 'monthly' || schedule.schedule_type === 'monthly_weekday') {
    const [y0, m0] = (afterDate < start ? start : addDaysToDateString(afterDate, 1)).split('-').map(Number);
    return iterateMonthlyCandidates(schedule, y0, m0, 36, (candidate) => candidate > afterDate && candidate >= start);
  }

  return null;
}

export function isFrequencySeriesEnded(schedule, plannedDate, timeZone) {
  if (schedule.ends_on && plannedDate > schedule.ends_on) return true;
  if (schedule.max_occurrences != null && (schedule.occurrences_completed ?? 0) >= schedule.max_occurrences) return true;
  if (schedule.schedule_type === 'once' && (schedule.occurrences_completed ?? 0) >= 1) return true;
  return false;
}

/** Build schedule row fields + due_at / available_at ISO strings for insert. */
export function buildFrequencyDueTimes(form, timeZone) {
  const schedule = formToScheduleRow(form);
  const planned = firstPlannedDate(schedule, timeZone);
  if (!planned) return null;

  const resolvedDate = resolveSendDate(planned, { sendOnWeekends: form.send_on_weekends });
  if (isFrequencySeriesEnded(schedule, resolvedDate, timeZone)) return null;

  const time = (form.schedule_time || '09:00').slice(0, 5);
  const dueAt = zonedDateTimeToUtc(resolvedDate, `${time}:00`, timeZone);
  return {
    due_at: dueAt.toISOString(),
    available_at: dueAt.toISOString()
  };
}

export function formToScheduleRow(form) {
  return {
    schedule_type: form.schedule_type,
    schedule_time: form.schedule_time,
    schedule_day_of_week: form.schedule_day_of_week,
    schedule_day_of_month: form.schedule_day_of_month,
    schedule_week_of_month: form.schedule_week_of_month,
    schedule_once_date: form.schedule_once_date || null,
    starts_on: form.starts_on || getDateInTimeZone(new Date(), 'America/Toronto'),
    ends_on: form.end_mode === 'end_date' && form.ends_on ? form.ends_on : null,
    max_occurrences:
      form.end_mode === 'max_occurrences' && form.max_occurrences !== ''
        ? Number(form.max_occurrences)
        : null,
    occurrences_completed: 0,
    send_on_weekends: !!form.send_on_weekends
  };
}

export function scheduleFieldsForInsert(form) {
  if (form.due_schedule_mode === TODAY_PRIORITY_SCHEDULE_MODE) {
    return {
      due_schedule_mode: TODAY_PRIORITY_SCHEDULE_MODE,
      schedule_type: null,
      schedule_time: null,
      schedule_day_of_week: null,
      schedule_day_of_month: null,
      schedule_week_of_month: null,
      schedule_once_date: null,
      starts_on: null,
      ends_on: null,
      max_occurrences: null,
      send_on_weekends: false
    };
  }

  if (form.due_schedule_mode === KIOSK_CHECKLIST_SCHEDULE_MODE) {
    return {
      due_schedule_mode: KIOSK_CHECKLIST_SCHEDULE_MODE,
      schedule_type: null,
      schedule_time: null,
      schedule_day_of_week: null,
      schedule_day_of_month: null,
      schedule_week_of_month: null,
      schedule_once_date: null,
      starts_on: null,
      ends_on: null,
      max_occurrences: null,
      send_on_weekends: false
    };
  }

  if (form.due_schedule_mode === 'daily_required') {
    const row = formToScheduleRow({ ...form, schedule_type: 'daily' });
    return {
      due_schedule_mode: 'daily_required',
      schedule_type: 'daily',
      schedule_time: row.schedule_time,
      schedule_day_of_week: null,
      schedule_day_of_month: null,
      schedule_week_of_month: null,
      schedule_once_date: null,
      starts_on: row.starts_on,
      ends_on: null,
      max_occurrences: null,
      send_on_weekends: row.send_on_weekends
    };
  }

  if (form.due_schedule_mode !== 'frequency') {
    return {
      due_schedule_mode: form.due_schedule_mode || 'specific_date',
      schedule_type: null,
      schedule_time: null,
      schedule_day_of_week: null,
      schedule_day_of_month: null,
      schedule_week_of_month: null,
      schedule_once_date: null,
      starts_on: null,
      ends_on: null,
      max_occurrences: null,
      send_on_weekends: false
    };
  }

  const row = formToScheduleRow(form);
  return {
    due_schedule_mode: 'frequency',
    schedule_type: row.schedule_type,
    schedule_time: row.schedule_time,
    schedule_day_of_week: row.schedule_day_of_week,
    schedule_day_of_month: row.schedule_day_of_month,
    schedule_week_of_month: row.schedule_week_of_month,
    schedule_once_date: row.schedule_once_date,
    starts_on: row.starts_on,
    ends_on: row.ends_on,
    max_occurrences: row.max_occurrences,
    send_on_weekends: row.send_on_weekends
  };
}

export function formatZonedDateTime(iso, timeZone = 'America/Toronto') {
  const parsed = parseStoredTimestamp(iso);
  if (!parsed) return '';
  return parsed.tz(resolveTaskTimezone(timeZone)).format('MMM D, YYYY h:mm A');
}

/** Map stored UTC ISO to YYYY-MM-DDTHH:mm for date/time form fields in business timezone. */
export function utcIsoToFormDatetimeLocal(iso, timeZone = 'America/Toronto') {
  const parsed = parseStoredTimestamp(iso);
  if (!parsed) return '';
  return parsed.tz(resolveTaskTimezone(timeZone)).format('YYYY-MM-DDTHH:mm');
}

export function utcIsoToFormTime(iso, timeZone = 'America/Toronto') {
  const parsed = parseStoredTimestamp(iso);
  if (!parsed) return '';
  return parsed.tz(resolveTaskTimezone(timeZone)).format('HH:mm');
}

export function formatDueScheduleLabel(task, timeZone = 'America/Toronto') {
  if (task.due_schedule_mode === TODAY_PRIORITY_SCHEDULE_MODE) {
    return "Today's task (kiosk priority)";
  }
  if (task.due_schedule_mode === KIOSK_CHECKLIST_SCHEDULE_MODE) {
    return 'Kiosk checklist (staff opens when ready)';
  }
  if (task.due_schedule_mode === 'daily_required') {
    const timeLabel = task.schedule_time ? ` at ${String(task.schedule_time).slice(0, 5)}` : '';
    return `Daily required${timeLabel}`;
  }
  if (task.due_schedule_mode === 'weekly_round_robin') return 'Weekly round robin (carryover + Sunday refresh)';
  if (task.due_schedule_mode === 'biweekly_round_robin') return 'Bi-weekly round robin (carryover + every 2 weeks)';
  if (task.due_schedule_mode === 'round_robin') return 'Round robin';
  if (task.due_schedule_mode === 'frequency') {
    const type = task.schedule_type || 'recurring';
    const label = TASK_SCHEDULE_TYPES.find((t) => t.value === type)?.label || type.replace('_', ' ');
    const timeLabel = task.schedule_time ? ` at ${String(task.schedule_time).slice(0, 5)}` : '';
    return `Recurring (${label.toLowerCase()}${timeLabel})`;
  }
  const displayAt = task.scheduled_for || task.due_at;
  if (displayAt) return `Due ${formatZonedDateTime(displayAt, timeZone)}`;
  return 'No due date';
}
