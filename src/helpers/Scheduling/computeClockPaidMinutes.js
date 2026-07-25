import dayjs from 'dayjs';

/**
 * Unpaid break minutes — sum duration_minutes for unpaid rows; derive from start/end when duration missing.
 */
export function unpaidBreakMinutesFromBreakRows(breakRows) {
  if (!breakRows?.length) return 0;
  let total = 0;
  for (const b of breakRows) {
    if (b.is_paid || b.break_type === 'paid') continue;
    let dm = b.duration_minutes;
    if ((dm == null || dm === '') && b.break_start_at && b.break_end_at) {
      const derived = dayjs(b.break_end_at).diff(dayjs(b.break_start_at), 'minute');
      dm = derived > 0 ? derived : 0;
    }
    if (dm != null && dm !== '' && !Number.isNaN(parseFloat(dm))) {
      total += parseFloat(dm);
    }
  }
  return total;
}

export function grossWorkMinutes(clockInIso, clockOutIso) {
  if (!clockInIso || !clockOutIso) return null;
  return dayjs(clockOutIso).diff(dayjs(clockInIso), 'minute');
}

/** True when clock-out is missing or not after clock-in (bad punch data). */
export function isInvalidClockPair(clockInIso, clockOutIso) {
  const grossMinutes = grossWorkMinutes(clockInIso, clockOutIso);
  return grossMinutes == null || grossMinutes <= 0;
}

/**
 * Paid work minutes for one clock row — matches payroll aggregation (skips invalid pairs at 0).
 */
export function computePaidMinutesForClock({
  clockInIso,
  clockOutIso,
  breakRows = [],
  breakDurationMinutes = 0
}) {
  if (!clockInIso || !clockOutIso) return 0;

  const grossMinutes = grossWorkMinutes(clockInIso, clockOutIso);
  if (grossMinutes == null || grossMinutes <= 0) return 0;

  let unpaidBreakMin = unpaidBreakMinutesFromBreakRows(breakRows);
  if (breakRows.length === 0) {
    unpaidBreakMin = parseFloat(breakDurationMinutes) || 0;
  }

  return Math.max(0, grossMinutes - unpaidBreakMin);
}

export function computePaidHoursForClock(args) {
  return computePaidMinutesForClock(args) / 60;
}
