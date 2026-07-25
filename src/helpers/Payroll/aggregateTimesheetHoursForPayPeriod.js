import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { supabase } from '../../supabaseClient';
import { computePaidMinutesForClock } from '../Scheduling/computeClockPaidMinutes';
import {
  buildSchedulePresenceByEmployeeDate,
  shouldExcludeClockHoursForAbsentOnlyScheduleDay
} from '../Scheduling/shiftLeadResolution';
import { getCanadianStatHolidaysForPeriod } from '../../utils/canadianStatHolidays';

dayjs.extend(utc);
dayjs.extend(timezone);

export async function getBusinessTimezoneForPayroll(businessId) {
  if (!businessId) return 'America/Toronto';
  const { data, error } = await supabase
    .from('businesses')
    .select('timezone')
    .eq('id', businessId)
    .maybeSingle();
  if (error) {
    console.warn('[aggregateTimesheetHoursForPayPeriod] timezone fetch:', error.message);
  }
  return data?.timezone || 'America/Toronto';
}

function roundHours(h) {
  return Math.round(h * 100) / 100;
}

/**
 * Sums paid hours from scheduling_time_clocks for clocks whose clock-in falls in [periodStart, periodEnd]
 * in the business timezone. Only rows with clock_out_time are counted.
 *
 * Hours match the Timesheets module: (clock_out − clock_in) minus unpaid breaks from scheduling_break_tracking,
 * with fallback to scheduling_time_clocks.break_duration_minutes when no break rows exist.
 * We intentionally do not use scheduling_time_clocks.total_hours — it can be stale vs edited clocks/breaks.
 *
 * @returns {{ byEmployeeId: Record<string, number>, statByEmployeeId: Record<string, number>, timezone: string, clockCount: number, statHolidayDates: string[] }}
 */
export async function aggregateTimesheetHoursForPayPeriod({
  businessId,
  periodStart,
  periodEnd
}) {
  if (!businessId || !periodStart || !periodEnd) {
    return {
      byEmployeeId: {},
      statByEmployeeId: {},
      timezone: 'America/Toronto',
      clockCount: 0,
      statHolidayDates: []
    };
  }

  const tz = await getBusinessTimezoneForPayroll(businessId);

  const { data: payrollSettings } = await supabase
    .from('hrpayroll_settings')
    .select('tax_jurisdiction')
    .eq('business_id', businessId)
    .maybeSingle();

  const jurisdiction = payrollSettings?.tax_jurisdiction || 'ON';
  const statHolidays = getCanadianStatHolidaysForPeriod({
    jurisdiction,
    periodStart,
    periodEnd
  });
  const statDateSet = new Set(statHolidays.map((h) => h.date));
  const startUtc = dayjs.tz(`${periodStart}T00:00:00`, tz).utc().toISOString();
  const endUtc = dayjs.tz(`${periodEnd}T23:59:59.999`, tz).utc().toISOString();

  const [{ data: clocks, error }, { data: shifts, error: shiftsError }] = await Promise.all([
    supabase
      .from('scheduling_time_clocks')
      .select('id, employee_id, clock_in_time, clock_out_time, break_duration_minutes')
      .eq('business_id', businessId)
      .gte('clock_in_time', startUtc)
      .lte('clock_in_time', endUtc)
      .order('clock_in_time'),
    supabase
      .from('scheduling_shifts')
      .select('employee_id, shift_date, status')
      .eq('business_id', businessId)
      .gte('shift_date', periodStart)
      .lte('shift_date', periodEnd)
      .not('employee_id', 'is', null)
  ]);

  if (error) throw error;
  if (shiftsError) throw shiftsError;

  const schedulePresence = buildSchedulePresenceByEmployeeDate(shifts || []);

  const clockIds = (clocks || []).map((c) => c.id).filter(Boolean);
  /** @type {Record<string, Array<{ duration_minutes?: number, is_paid?: boolean, break_start_at?: string, break_end_at?: string }>>} */
  const breaksByClockId = {};

  if (clockIds.length > 0) {
    const { data: breakRows, error: breaksErr } = await supabase
      .from('scheduling_break_tracking')
      .select('time_clock_id, duration_minutes, is_paid, break_start_at, break_end_at')
      .in('time_clock_id', clockIds);

    if (breaksErr) throw breaksErr;

    (breakRows || []).forEach((b) => {
      const tid = b.time_clock_id;
      if (!tid) return;
      if (!breaksByClockId[tid]) breaksByClockId[tid] = [];
      breaksByClockId[tid].push(b);
    });
  }

  const byEmployeeId = {};
  const statByEmployeeId = {};

  (clocks || []).forEach((row) => {
    if (!row.employee_id || !row.clock_out_time) return;

    const breakRows = breaksByClockId[row.id] || [];
    const paidMinutes = computePaidMinutesForClock({
      clockInIso: row.clock_in_time,
      clockOutIso: row.clock_out_time,
      breakRows,
      breakDurationMinutes: row.break_duration_minutes
    });
    const hours = paidMinutes / 60;

    if (hours <= 0) return;

    const id = row.employee_id;
    const localDate = dayjs(row.clock_in_time).tz(tz).format('YYYY-MM-DD');
    if (shouldExcludeClockHoursForAbsentOnlyScheduleDay(id, localDate, schedulePresence)) return;

    byEmployeeId[id] = (byEmployeeId[id] || 0) + hours;
    if (statDateSet.has(localDate)) {
      statByEmployeeId[id] = (statByEmployeeId[id] || 0) + hours;
    }
  });

  Object.keys(byEmployeeId).forEach((id) => {
    byEmployeeId[id] = roundHours(byEmployeeId[id]);
  });
  Object.keys(statByEmployeeId).forEach((id) => {
    statByEmployeeId[id] = roundHours(statByEmployeeId[id]);
  });

  return {
    byEmployeeId,
    statByEmployeeId,
    timezone: tz,
    clockCount: (clocks || []).length,
    statHolidayDates: statHolidays.map((h) => h.date)
  };
}
