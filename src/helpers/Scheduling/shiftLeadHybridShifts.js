/**
 * Hybrid clock + schedule rows for shift-lead resolution (Timesheets + payroll aggregation).
 * Open punches must not be replaced by full-day scheduled shifts, or the wrong key holder "wins".
 */
import { isShiftPresentForShiftLeadPooling } from './shiftLeadResolution';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

function earliestDayjs(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => (a.valueOf() <= b.valueOf() ? a : b));
}

function parseTimeToMinutes(timeString) {
  if (!timeString) return null;
  const [hoursStr, minutesStr, secondsStr] = String(timeString).split(':');
  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr || '0', 10);
  const seconds = parseInt(secondsStr || '0', 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes + Math.floor(seconds / 60);
}

function minutesToHms(totalMinutes) {
  let m = Math.round(totalMinutes) % (24 * 60);
  if (m < 0) m += 24 * 60;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
}

function dayjsToMinutes(d) {
  return d.hour() * 60 + d.minute() + Math.floor(d.second() / 60);
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

function fallbackPositionFromTimecards(list) {
  const last = list[list.length - 1];
  return (
    last?.scheduled_shift?.position ||
    last?.position ||
    last?.users?.position ||
    list[0]?.scheduled_shift?.position ||
    list[0]?.position ||
    list[0]?.users?.position ||
    ''
  );
}

function scheduledShiftsForEmployeeDay(scheduledShifts, empId, dateKey) {
  return (scheduledShifts || [])
    .filter(
      (s) =>
        s.employee_id === empId &&
        s.shift_date === dateKey &&
        isShiftPresentForShiftLeadPooling(s)
    )
    .sort((a, b) => {
      const sa = parseTimeToMinutes(a.start_time) ?? 0;
      const sb = parseTimeToMinutes(b.start_time) ?? 0;
      return sa - sb;
    });
}

/** Emit one row per scheduled segment intersecting the clock span (multi-role days). */
function pushSegmentRowsFromSchedule(out, empId, dateKey, clockStartMin, clockEndMin, dayScheduled, fallbackPos) {
  if (clockEndMin <= clockStartMin) return;

  if (dayScheduled.length === 0) {
    out.push({
      employee_id: empId,
      shift_date: dateKey,
      start_time: minutesToHms(clockStartMin),
      end_time: minutesToHms(clockEndMin),
      position: fallbackPos
    });
    return;
  }

  for (const sched of dayScheduled) {
    const sm = getShiftMinutes(sched);
    if (!sm) continue;
    const segStart = Math.max(sm.start, clockStartMin);
    const segEnd = Math.min(sm.end, clockEndMin);
    if (segEnd <= segStart) continue;
    const pos = (sched.position && String(sched.position).trim()) || fallbackPos;
    out.push({
      employee_id: empId,
      shift_date: dateKey,
      start_time: minutesToHms(segStart),
      end_time: minutesToHms(segEnd),
      position: pos
    });
  }

  const firstSm = getShiftMinutes(dayScheduled[0]);
  if (firstSm && clockStartMin < firstSm.start) {
    const pos = (dayScheduled[0].position && String(dayScheduled[0].position).trim()) || fallbackPos;
    const segEnd = Math.min(firstSm.start, clockEndMin);
    if (segEnd > clockStartMin) {
      out.push({
        employee_id: empId,
        shift_date: dateKey,
        start_time: minutesToHms(clockStartMin),
        end_time: minutesToHms(segEnd),
        position: pos
      });
    }
  }

  const lastSched = dayScheduled[dayScheduled.length - 1];
  const lastSm = getShiftMinutes(lastSched);
  if (lastSm && clockEndMin > lastSm.end) {
    const pos = (lastSched.position && String(lastSched.position).trim()) || fallbackPos;
    const segStart = Math.max(lastSm.end, clockStartMin);
    if (clockEndMin > segStart) {
      out.push({
        employee_id: empId,
        shift_date: dateKey,
        start_time: minutesToHms(segStart),
        end_time: minutesToHms(clockEndMin),
        position: pos
      });
    }
  }
}

/**
 * Provisional clock-out for open punches (UI estimates + shift-lead presence only).
 * Min of: now, store close that day, clock-in + 16h — never before clock-in.
 */
export function resolveSyntheticClockOutIso({
  dateKey,
  clockInIso,
  businessTimezone,
  operatingHours
}) {
  const ci = dayjs(clockInIso).tz(businessTimezone);
  const dow = dayjs.tz(`${dateKey}T12:00:00`, businessTimezone).format('dddd').toLowerCase();
  const dayHours = operatingHours?.[dow];
  let close = null;
  if (dayHours && dayHours.closed !== true && dayHours.close) {
    const closeStr = String(dayHours.close).substring(0, 5);
    close = dayjs.tz(`${dateKey}T${closeStr}:00`, businessTimezone);
    if (!close.isValid()) close = null;
  }
  const now = dayjs().tz(businessTimezone);
  const cap16 = ci.add(16, 'hour');
  const candidates = [now, cap16];
  if (close) candidates.push(close);
  const end = earliestDayjs(candidates);
  if (!end || !end.isAfter(ci)) return ci.add(1, 'minute').toISOString();
  return end.toISOString();
}

/**
 * Clock intervals for shift-lead pooling. When an employee has multiple scheduled roles on one day,
 * split the merged punch span by schedule segments so evening key-holder shifts count correctly.
 */
export function buildClockMergedShiftRows(
  timecards,
  scheduledShifts,
  rangeStart,
  rangeEnd,
  businessTimezone
) {
  const real = timecards.filter(
    (tc) => !tc.is_scheduled_placeholder && tc.clock_in_time && tc.clock_out_time
  );
  const groups = new Map();
  for (const tc of real) {
    const d = dayjs(tc.clock_in_time).tz(businessTimezone).format('YYYY-MM-DD');
    if (d < rangeStart || d > rangeEnd) continue;
    const k = `${tc.employee_id}|${d}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(tc);
  }
  const out = [];
  for (const list of groups.values()) {
    list.sort((a, b) => dayjs(a.clock_in_time).valueOf() - dayjs(b.clock_in_time).valueOf());
    const start = dayjs(list[0].clock_in_time).tz(businessTimezone);
    const end = dayjs(list[list.length - 1].clock_out_time).tz(businessTimezone);
    const dateKey = start.format('YYYY-MM-DD');
    const empId = list[0].employee_id;
    const fallbackPos = fallbackPositionFromTimecards(list);
    const dayScheduled = scheduledShiftsForEmployeeDay(scheduledShifts, empId, dateKey);
    pushSegmentRowsFromSchedule(
      out,
      empId,
      dateKey,
      dayjsToMinutes(start),
      dayjsToMinutes(end),
      dayScheduled,
      fallbackPos
    );
  }
  return out;
}

/** Open punches: synthetic end so shift-lead logic does not substitute a full scheduled shift. */
export function buildOpenClockShiftRowsForLead(
  timecards,
  scheduledShifts,
  rangeStart,
  rangeEnd,
  businessTimezone,
  operatingHours
) {
  const open = timecards.filter(
    (tc) => !tc.is_scheduled_placeholder && tc.clock_in_time && !tc.clock_out_time
  );
  const out = [];
  for (const tc of open) {
    const dateKey = dayjs(tc.clock_in_time).tz(businessTimezone).format('YYYY-MM-DD');
    if (dateKey < rangeStart || dateKey > rangeEnd) continue;
    const syntheticOut = resolveSyntheticClockOutIso({
      dateKey,
      clockInIso: tc.clock_in_time,
      businessTimezone,
      operatingHours
    });
    const start = dayjs(tc.clock_in_time).tz(businessTimezone);
    const end = dayjs(syntheticOut).tz(businessTimezone);
    const fallbackPos = tc.scheduled_shift?.position || tc.position || tc.users?.position || '';
    const dayScheduled = scheduledShiftsForEmployeeDay(scheduledShifts, tc.employee_id, dateKey);
    pushSegmentRowsFromSchedule(
      out,
      tc.employee_id,
      dateKey,
      dayjsToMinutes(start),
      dayjsToMinutes(end),
      dayScheduled,
      fallbackPos
    );
  }
  return out;
}

/**
 * Prefer clock-based intervals when punches exist; otherwise scheduled shifts.
 * Any real clock-in (including open) blocks scheduled fill for that employee+day.
 */
export function buildHybridShiftsForShiftLead(
  timecards,
  scheduledShifts,
  rangeStart,
  rangeEnd,
  businessTimezone,
  operatingHours = null
) {
  const clockBased = buildClockMergedShiftRows(
    timecards,
    scheduledShifts,
    rangeStart,
    rangeEnd,
    businessTimezone
  );
  const openBased = buildOpenClockShiftRowsForLead(
    timecards,
    scheduledShifts,
    rangeStart,
    rangeEnd,
    businessTimezone,
    operatingHours
  );
  const haveReal = new Set();
  for (const tc of timecards || []) {
    if (tc.is_scheduled_placeholder || !tc.clock_in_time) continue;
    const d = dayjs(tc.clock_in_time).tz(businessTimezone).format('YYYY-MM-DD');
    if (d < rangeStart || d > rangeEnd) continue;
    haveReal.add(`${tc.employee_id}|${d}`);
  }
  const combined = [...clockBased, ...openBased];
  if (combined.length === 0) return scheduledShifts || [];
  const scheduledFill = (scheduledShifts || []).filter((s) => {
    if (!s.shift_date || s.shift_date < rangeStart || s.shift_date > rangeEnd) return false;
    const k = `${s.employee_id}|${s.shift_date}`;
    if (haveReal.has(k)) return false;
    return isShiftPresentForShiftLeadPooling(s);
  });
  return [...combined, ...scheduledFill];
}
