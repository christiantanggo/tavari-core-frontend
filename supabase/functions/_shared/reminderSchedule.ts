/** Shared scheduling helpers for Tavari Reminder dispatch and actions. */

export type HolidayEntry = {
  id?: string;
  date: string;
  name?: string;
  closed?: boolean;
  hours?: { open?: string; close?: string };
};

export type ReminderRow = {
  id: string;
  business_id: string;
  schedule_type: "once" | "weekly" | "biweekly" | "monthly" | "monthly_weekday" | "quarterly";
  schedule_time: string;
  schedule_day_of_week: number | null;
  schedule_day_of_month: number | null;
  /** 1–4 = first…fourth; 5 = last occurrence of that weekday in the month */
  schedule_week_of_month: number | null;
  schedule_once_date: string | null;
  starts_on: string;
  ends_on: string | null;
  max_occurrences: number | null;
  occurrences_sent: number;
  send_on_weekends: boolean;
  paused: boolean;
  repeat_until_complete?: boolean | null;
  repeat_max?: number | null;
};

export function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function getDateInTimeZone(date: Date, timeZone: string) {
  const p = getZonedParts(date, timeZone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function addDaysToDateString(dateValue: string, days: number) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return d.toISOString().slice(0, 10);
}

export function zonedDateTimeToUtc(dateValue: string, timeValue: string, timeZone: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = timeValue.split(":").map(Number);
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
      zonedParts.second,
    );
    candidate = new Date(candidate.getTime() + (targetTime - zonedAsUtc));
  }
  return candidate;
}

export function isWeekendDate(dateValue: string) {
  const [y, m, d] = dateValue.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return dow === 0 || dow === 6;
}

export function isHolidayDate(dateValue: string, holidays: HolidayEntry[]) {
  return holidays.some((h) => h.date === dateValue);
}

export function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
}

export function resolveMonthlyDay(year: number, month: number, dayOfMonth: number) {
  const last = lastDayOfMonth(year, month);
  return Math.min(dayOfMonth, last);
}

/** Day-of-month for nth weekday (weekOfMonth 5 = last). Returns null if not found. */
export function resolveNthWeekdayOfMonth(
  year: number,
  month: number,
  weekOfMonth: number,
  dayOfWeek: number,
): number | null {
  const last = lastDayOfMonth(year, month);
  if (weekOfMonth === 5) {
    for (let day = last; day >= 1; day -= 1) {
      const dow = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
      if (dow === dayOfWeek) return day;
    }
    return null;
  }
  let seen = 0;
  for (let day = 1; day <= last; day += 1) {
    const dow = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
    if (dow === dayOfWeek) {
      seen += 1;
      if (seen === weekOfMonth) return day;
    }
  }
  return null;
}

function plannedDateForMonth(reminder: ReminderRow, year: number, month: number): string | null {
  if (reminder.schedule_type === "monthly") {
    const dom = reminder.schedule_day_of_month ?? 1;
    const day = resolveMonthlyDay(year, month, dom);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (reminder.schedule_type === "monthly_weekday") {
    const week = reminder.schedule_week_of_month ?? 1;
    const dow = reminder.schedule_day_of_week ?? 1;
    const day = resolveNthWeekdayOfMonth(year, month, week, dow);
    if (day == null) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

function dayOfWeekForDate(dateValue: string) {
  const [y, m, d] = dateValue.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

/** First date on or after `fromDate` that matches `targetDow` (0=Sun … 6=Sat). */
function firstWeekdayOnOrAfter(fromDate: string, targetDow: number) {
  let cursor = fromDate;
  for (let i = 0; i < 370; i += 1) {
    if (dayOfWeekForDate(cursor) === targetDow) return cursor;
    cursor = addDaysToDateString(cursor, 1);
  }
  return fromDate;
}

/** Anchor for bi-weekly cadence: first matching weekday on or after starts_on. */
function getBiweeklyAnchor(reminder: ReminderRow) {
  const targetDow = reminder.schedule_day_of_week ?? 1;
  return firstWeekdayOnOrAfter(reminder.starts_on, targetDow);
}

/** Next bi-weekly planned date strictly after `afterDate` (if set) and on or after `minDate`. */
function nextBiweeklyPlannedDate(reminder: ReminderRow, afterDate: string | null, minDate: string) {
  const anchor = getBiweeklyAnchor(reminder);
  const floor = afterDate ? addDaysToDateString(afterDate, 1) : minDate;
  let cursor = anchor;
  while (cursor < floor) {
    cursor = addDaysToDateString(cursor, 14);
  }
  return cursor;
}

function iterateMonthlyCandidates(
  reminder: ReminderRow,
  startY: number,
  startM: number,
  maxMonths: number,
  predicate: (candidate: string) => boolean,
): string | null {
  for (let offset = 0; offset < maxMonths; offset += 1) {
    const monthIndex = startM - 1 + offset;
    const year = startY + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const candidate = plannedDateForMonth(reminder, year, month);
    if (candidate && predicate(candidate)) return candidate;
  }
  return null;
}

/** Every 3 months on schedule_day_of_month, anchored to starts_on month. */
function iterateQuarterlyCandidates(
  reminder: ReminderRow,
  predicate: (candidate: string) => boolean,
  maxQuarters = 40,
): string | null {
  const [anchorY, anchorM] = reminder.starts_on.split("-").map(Number);
  const dom = reminder.schedule_day_of_month ?? 1;
  for (let q = 0; q < maxQuarters; q += 1) {
    const monthIndex = anchorY * 12 + (anchorM - 1) + q * 3;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const day = resolveMonthlyDay(year, month, dom);
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (predicate(candidate)) return candidate;
  }
  return null;
}

/** Advance calendar day until allowed by weekend + holiday rules. */
export function resolveSendDate(
  startDate: string,
  opts: {
    sendOnWeekends: boolean;
    holidays: HolidayEntry[];
    timeZone: string;
  },
  maxIterations = 400,
): string {
  let cursor = startDate;
  for (let i = 0; i < maxIterations; i += 1) {
    const weekendBlocked = !opts.sendOnWeekends && isWeekendDate(cursor);
    const holidayBlocked = isHolidayDate(cursor, opts.holidays);
    if (!weekendBlocked && !holidayBlocked) return cursor;
    cursor = addDaysToDateString(cursor, 1);
  }
  return cursor;
}

export function computeSendAt(dateValue: string, scheduleTime: string, timeZone: string) {
  const normalizedTime = scheduleTime.length === 5 ? `${scheduleTime}:00` : scheduleTime;
  return zonedDateTimeToUtc(dateValue, normalizedTime, timeZone);
}

/** Next planned calendar date for recurrence (before holiday/weekend adjustment). */
export function nextPlannedDate(
  reminder: ReminderRow,
  afterDate: string,
  timeZone: string,
): string | null {
  const today = getDateInTimeZone(new Date(), timeZone);
  const start = reminder.starts_on > today ? reminder.starts_on : today;

  if (reminder.schedule_type === "once") {
    const once = reminder.schedule_once_date;
    if (!once || once <= afterDate) return null;
    if (once < start) return null;
    return once;
  }

  if (reminder.schedule_type === "weekly") {
    const targetDow = reminder.schedule_day_of_week ?? 1;
    let cursor = afterDate < start ? start : addDaysToDateString(afterDate, 1);
    for (let i = 0; i < 370; i += 1) {
      if (dayOfWeekForDate(cursor) === targetDow) return cursor;
      cursor = addDaysToDateString(cursor, 1);
    }
    return null;
  }

  if (reminder.schedule_type === "biweekly") {
    const candidate = nextBiweeklyPlannedDate(reminder, afterDate, start);
    if (candidate < start) return null;
    return candidate;
  }

  if (reminder.schedule_type === "monthly" || reminder.schedule_type === "monthly_weekday") {
    const [y0, m0] = (afterDate < start ? start : addDaysToDateString(afterDate, 1)).split("-").map(Number);
    return iterateMonthlyCandidates(reminder, y0, m0, 36, (candidate) => candidate > afterDate && candidate >= start);
  }

  if (reminder.schedule_type === "quarterly") {
    return iterateQuarterlyCandidates(
      reminder,
      (candidate) => candidate > afterDate && candidate >= start,
    );
  }

  return null;
}

export function firstPlannedDate(reminder: ReminderRow, timeZone: string): string | null {
  const today = getDateInTimeZone(new Date(), timeZone);
  const start = reminder.starts_on > today ? reminder.starts_on : today;

  if (reminder.schedule_type === "once") {
    const once = reminder.schedule_once_date;
    if (!once || once < start) return null;
    return once;
  }

  if (reminder.schedule_type === "weekly") {
    const targetDow = reminder.schedule_day_of_week ?? 1;
    let cursor = start;
    for (let i = 0; i < 370; i += 1) {
      if (dayOfWeekForDate(cursor) === targetDow) return cursor;
      cursor = addDaysToDateString(cursor, 1);
    }
    return null;
  }

  if (reminder.schedule_type === "biweekly") {
    return nextBiweeklyPlannedDate(reminder, null, start);
  }

  if (reminder.schedule_type === "monthly" || reminder.schedule_type === "monthly_weekday") {
    const [y0, m0] = start.split("-").map(Number);
    return iterateMonthlyCandidates(reminder, y0, m0, 36, (candidate) => candidate >= start);
  }

  if (reminder.schedule_type === "quarterly") {
    return iterateQuarterlyCandidates(reminder, (candidate) => candidate >= start);
  }

  return null;
}

export function isSeriesEnded(reminder: ReminderRow, plannedDate: string, timeZone: string) {
  if (reminder.ends_on && plannedDate > reminder.ends_on) return true;
  if (reminder.max_occurrences != null && reminder.occurrences_sent >= reminder.max_occurrences) return true;
  if (reminder.schedule_type === "once" && reminder.occurrences_sent >= 1) return true;
  const today = getDateInTimeZone(new Date(), timeZone);
  if (reminder.ends_on && today > reminder.ends_on && reminder.schedule_type !== "once") {
    // still allow pending occurrences
  }
  return false;
}

export function parseHolidayHours(raw: unknown): HolidayEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object" && "date" in item)
    .map((item) => ({
      id: (item as HolidayEntry).id,
      date: String((item as HolidayEntry).date),
      name: (item as HolidayEntry).name,
      closed: Boolean((item as HolidayEntry).closed),
      hours: (item as HolidayEntry).hours,
    }));
}
