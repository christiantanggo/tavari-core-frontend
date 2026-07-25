function parseTimeParts(timeValue?: string | null): { hour: number; minute: number } {
  const raw = (timeValue || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return { hour: 23, minute: 59 };
  return {
    hour: Math.max(0, Math.min(23, parseInt(match[1], 10) || 0)),
    minute: Math.max(0, Math.min(59, parseInt(match[2], 10) || 0)),
  };
}

function formatLocalParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: parseInt(get('hour'), 10) || 0,
    minute: parseInt(get('minute'), 10) || 0,
  };
}

function findUtcForLocalMinute(batchDate: string, timezone: string, hour: number, minute: number): Date | null {
  const dateOnly = batchDate.slice(0, 10);
  const baseUtc = new Date(`${dateOnly}T00:00:00.000Z`);
  for (let minuteOffset = -12 * 60; minuteOffset <= 36 * 60; minuteOffset++) {
    const candidate = new Date(baseUtc.getTime() + minuteOffset * 60 * 1000);
    const local = formatLocalParts(candidate, timezone);
    const localDateStr = `${local.year}-${local.month}-${local.day}`;
    if (localDateStr === dateOnly && local.hour === hour && local.minute === minute) {
      return candidate;
    }
  }
  return null;
}

export function getDayWindowUtc(
  batchDate: string,
  timezone: string,
  dayEndTime?: string | null
): { startUtc: string; endUtc: string } {
  const tz = timezone || 'America/Toronto';
  const dateOnly = batchDate.slice(0, 10);
  const { hour: endHour, minute: endMinute } = parseTimeParts(dayEndTime);
  const start = findUtcForLocalMinute(dateOnly, tz, 0, 0);
  const endMinuteUtc = findUtcForLocalMinute(dateOnly, tz, endHour, endMinute);
  const fallbackStart = new Date(`${dateOnly}T00:00:00.000Z`);
  const fallbackEnd = new Date(`${dateOnly}T23:59:59.999Z`);
  return {
    startUtc: (start || fallbackStart).toISOString(),
    endUtc: (endMinuteUtc ? new Date(endMinuteUtc.getTime() + 59 * 1000 + 999) : fallbackEnd).toISOString(),
  };
}

export function getPeriodWindowUtc(
  fromDate: string,
  toDate: string,
  timezone: string,
  dayEndTime?: string | null
): { startUtc: string; endUtc: string } {
  const start = getDayWindowUtc(fromDate, timezone, dayEndTime);
  const end = getDayWindowUtc(toDate, timezone, dayEndTime);
  return { startUtc: start.startUtc, endUtc: end.endUtc };
}

export function formatDateInTimezone(iso: string, timezone: string): string {
  const d = new Date(iso);
  const local = formatLocalParts(d, timezone);
  return `${local.year}-${local.month}-${local.day}`;
}

/** Current calendar date (YYYY-MM-DD) in the business timezone — not UTC. */
export function todayInTimezone(timezone = 'America/Toronto'): string {
  const local = formatLocalParts(new Date(), timezone || 'America/Toronto');
  return `${local.year}-${local.month}-${local.day}`;
}

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Build YYYY-MM-DD from parts without UTC conversion (avoids off-by-one day). */
export function calendarDateFromParts(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function calendarDateFromMonthNameDayYear(monthName: string, day: number, year: number): string | null {
  const month = MONTH_NAME_TO_NUMBER[String(monthName || '').toLowerCase().trim()];
  if (!month) return null;
  return calendarDateFromParts(year, month, day);
}

/** Normalize to YYYY-MM-DD when input is already a calendar date string. */
export function normalizeCalendarDateString(input: string | null | undefined): string | null {
  const s = String(input || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
