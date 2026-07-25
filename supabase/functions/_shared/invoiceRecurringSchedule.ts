/** Monthly recurring invoice schedule helpers. */

export type RecurringTemplateRow = {
  id: string;
  frequency: string;
  schedule_day_of_month: number;
  starts_on: string;
  ends_on: string | null;
  max_occurrences: number | null;
  occurrences_sent: number;
  next_run_date: string;
};

export function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
}

export function resolveMonthlyDay(year: number, month: number, dayOfMonth: number) {
  const last = lastDayOfMonth(year, month);
  return Math.min(dayOfMonth, last);
}

export function addDaysToDateString(dateValue: string, days: number) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return d.toISOString().slice(0, 10);
}

export function getDateInTimeZone(date: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** First monthly run on or after starts_on for the given day-of-month. */
export function firstMonthlyRunDate(
  startsOn: string,
  dayOfMonth: number,
  timeZone: string,
): string {
  const today = getDateInTimeZone(new Date(), timeZone);
  const floor = startsOn > today ? startsOn : today;
  const [y0, m0] = floor.split("-").map(Number);

  for (let offset = 0; offset < 36; offset += 1) {
    const monthIndex = m0 - 1 + offset;
    const year = y0 + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const day = resolveMonthlyDay(year, month, dayOfMonth);
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (candidate >= floor) return candidate;
  }

  return floor;
}

/** Next monthly run strictly after afterDate. */
export function nextMonthlyRunDate(
  afterDate: string,
  dayOfMonth: number,
): string {
  const minDate = addDaysToDateString(afterDate, 1);
  const [y0, m0] = minDate.split("-").map(Number);

  for (let offset = 0; offset < 36; offset += 1) {
    const monthIndex = m0 - 1 + offset;
    const year = y0 + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const day = resolveMonthlyDay(year, month, dayOfMonth);
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (candidate >= minDate) return candidate;
  }

  return minDate;
}

export function templateHasEnded(
  template: RecurringTemplateRow,
  plannedDate: string,
): boolean {
  if (template.ends_on && plannedDate > template.ends_on) return true;
  if (
    template.max_occurrences != null &&
    template.occurrences_sent >= template.max_occurrences
  ) {
    return true;
  }
  return false;
}

export function computeDueDate(fromDate: string, dueDays: number) {
  return addDaysToDateString(fromDate, Math.max(0, dueDays));
}
