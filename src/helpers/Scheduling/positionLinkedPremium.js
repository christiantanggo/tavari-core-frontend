/**
 * Position-linked shift premiums (e.g. Day Camp Director → Day Camp Director Premium).
 * Hours accrue for paid time worked while scheduled/clocked in that role.
 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { normalizePositionName } from './shiftLeadResolution';

dayjs.extend(utc);
dayjs.extend(timezone);

function parseTimeToMinutes(timeString) {
  if (!timeString) return null;
  const [hoursStr, minutesStr, secondsStr] = String(timeString).split(':');
  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr || '0', 10);
  const seconds = parseInt(secondsStr || '0', 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes + Math.floor(seconds / 60);
}

function getShiftMinutes(shift) {
  const start = parseTimeToMinutes(
    shift?.start_time?.length > 5 ? shift.start_time.substring(0, 5) : shift?.start_time
  );
  const endRaw = parseTimeToMinutes(
    shift?.end_time?.length > 5 ? shift.end_time.substring(0, 5) : shift?.end_time
  );
  if (start === null || endRaw === null) return null;
  let end = endRaw;
  if (end <= start) end += 24 * 60;
  return { start, end };
}

function dayjsToMinutes(d) {
  return d.hour() * 60 + d.minute() + Math.floor(d.second() / 60);
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return e > s ? e - s : 0;
}

/** Positions row with a linked premium that is not a key-chain / shift-lead role. */
export function findPositionLinkedPremiumRow(positionName, positions) {
  const row = (positions || []).find(
    (p) => normalizePositionName(p.position_name) === normalizePositionName(positionName)
  );
  if (!row?.shift_premium_id) return null;
  if (row.shift_lead_eligible === true) return null;
  return row;
}

/**
 * Best scheduled shift for a punch: prefer the shift whose window contains clock-in.
 */
export function findMatchingShiftForTimecard(timecard, shifts, businessTimezone) {
  if (!timecard?.clock_in_time) return null;
  const timecardDate = dayjs(timecard.clock_in_time).tz(businessTimezone).format('YYYY-MM-DD');
  const matchingShifts = (shifts || []).filter(
    (shift) => shift.employee_id === timecard.employee_id && shift.shift_date === timecardDate
  );
  if (matchingShifts.length === 0) return null;
  if (matchingShifts.length === 1) return matchingShifts[0];

  const clockInMin = dayjsToMinutes(dayjs(timecard.clock_in_time).tz(businessTimezone));

  const containing = matchingShifts.filter((shift) => {
    const sm = getShiftMinutes(shift);
    return sm && clockInMin >= sm.start && clockInMin < sm.end;
  });
  if (containing.length === 1) return containing[0];
  if (containing.length > 1) {
    return containing.reduce((best, shift) => {
      const sm = getShiftMinutes(shift);
      const bestSm = getShiftMinutes(best);
      if (!sm) return best;
      if (!bestSm) return shift;
      const dur = sm.end - sm.start;
      const bestDur = bestSm.end - bestSm.start;
      return dur > bestDur ? shift : best;
    }, containing[0]);
  }

  const clockIn = dayjs(timecard.clock_in_time).tz(businessTimezone);
  return matchingShifts.reduce((closest, shift) => {
    const shiftStart = dayjs.tz(`${shift.shift_date}T${shift.start_time}`, businessTimezone);
    const closestStart = dayjs.tz(`${closest.shift_date}T${closest.start_time}`, businessTimezone);
    return Math.abs(clockIn.diff(shiftStart, 'minute')) < Math.abs(clockIn.diff(closestStart, 'minute'))
      ? shift
      : closest;
  }, matchingShifts[0]);
}

/**
 * Paid hours per scheduled role for one punch (handles split-role days).
 * @returns {Array<{ position: string, hours: number }>}
 */
export function getPositionLinkedHoursByRole({
  timecard,
  scheduledShifts,
  businessTimezone,
  paidWorkIntervalsMinutes
}) {
  if (!timecard?.clock_in_time) return [];

  const fallbackPosition =
    timecard.scheduled_shift?.position ||
    timecard.position ||
    timecard.users?.position ||
    '';

  let workIntervals = paidWorkIntervalsMinutes;
  if (!workIntervals?.length && timecard.clock_out_time) {
    const ci = dayjs(timecard.clock_in_time).tz(businessTimezone);
    const co = dayjs(timecard.clock_out_time).tz(businessTimezone);
    let startM = dayjsToMinutes(ci);
    let endM = dayjsToMinutes(co);
    if (endM <= startM) endM += 24 * 60;
    workIntervals = [{ start: startM, end: endM }];
  }
  if (!workIntervals?.length) return [];

  const dateKey = dayjs(timecard.clock_in_time).tz(businessTimezone).format('YYYY-MM-DD');
  const dayShifts = (scheduledShifts || []).filter(
    (s) => s.employee_id === timecard.employee_id && s.shift_date === dateKey
  );

  if (dayShifts.length === 0) {
    if (!fallbackPosition) return [];
    const totalMin = workIntervals.reduce((sum, iv) => sum + (iv.end - iv.start), 0);
    return totalMin > 0 ? [{ position: fallbackPosition, hours: totalMin / 60 }] : [];
  }

  const byPosition = new Map();
  for (const shift of dayShifts) {
    const sm = getShiftMinutes(shift);
    if (!sm) continue;
    const pos = (shift.position && String(shift.position).trim()) || fallbackPosition;
    if (!pos) continue;
    let minutes = 0;
    for (const iv of workIntervals) {
      minutes += overlapMinutes(iv.start, iv.end, sm.start, sm.end);
    }
    if (minutes <= 0) continue;
    byPosition.set(pos, (byPosition.get(pos) || 0) + minutes / 60);
  }

  if (byPosition.size === 0 && fallbackPosition) {
    const totalMin = workIntervals.reduce((sum, iv) => sum + (iv.end - iv.start), 0);
    if (totalMin > 0) return [{ position: fallbackPosition, hours: totalMin / 60 }];
  }

  return [...byPosition.entries()].map(([position, hours]) => ({ position, hours }));
}

/** Hours by shift_premium_id for one employee timecard. */
export function getPositionLinkedPremiumHoursForTimecard({
  timecard,
  scheduledShifts,
  positions,
  businessTimezone,
  paidWorkIntervalsMinutes
}) {
  const segments = getPositionLinkedHoursByRole({
    timecard,
    scheduledShifts,
    businessTimezone,
    paidWorkIntervalsMinutes
  });
  const byPremiumId = {};
  for (const seg of segments) {
    const row = findPositionLinkedPremiumRow(seg.position, positions);
    if (!row?.shift_premium_id || seg.hours <= 0) continue;
    const pid = String(row.shift_premium_id);
    byPremiumId[pid] = (byPremiumId[pid] || 0) + seg.hours;
  }
  return byPremiumId;
}
