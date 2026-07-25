/**
 * Client-side helpers for recurring invoice schedules (mirrors edge function logic).
 */

export function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
}

export function resolveMonthlyDay(year, month, dayOfMonth) {
  return Math.min(dayOfMonth, lastDayOfMonth(year, month));
}

export function addDaysToDateString(dateValue, days) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return d.toISOString().slice(0, 10);
}

export function firstMonthlyRunDate(startsOn, dayOfMonth) {
  const today = new Date().toISOString().slice(0, 10);
  const floor = startsOn > today ? startsOn : today;
  const [y0, m0] = floor.split('-').map(Number);

  for (let offset = 0; offset < 36; offset += 1) {
    const monthIndex = m0 - 1 + offset;
    const year = y0 + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const day = resolveMonthlyDay(year, month, dayOfMonth);
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (candidate >= floor) return candidate;
  }

  return floor;
}

export function nextMonthlyRunDate(afterDate, dayOfMonth) {
  const minDate = addDaysToDateString(afterDate, 1);
  const [y0, m0] = minDate.split('-').map(Number);

  for (let offset = 0; offset < 36; offset += 1) {
    const monthIndex = m0 - 1 + offset;
    const year = y0 + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const day = resolveMonthlyDay(year, month, dayOfMonth);
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (candidate >= minDate) return candidate;
  }

  return minDate;
}

export function formatRecurringSchedule(template) {
  const dom = template.schedule_day_of_month || 1;
  const suffix =
    dom === 1 || dom === 21 || dom === 31
      ? 'st'
      : dom === 2 || dom === 22
        ? 'nd'
        : dom === 3 || dom === 23
          ? 'rd'
          : 'th';
  return `Monthly on the ${dom}${suffix}`;
}
