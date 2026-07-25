import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { supabase } from '../../supabaseClient';
import {
  findShiftLeadPremiumPositionRow,
  getShiftLeadPremiumPayableMinutes,
  getShiftLeadPremiumRateRowForKeyChainEmployee,
  normalizePositionName,
  resolveShiftLeadForDay,
  subtractIntervalFromIntervals,
  buildSchedulePresenceByEmployeeDate,
  shouldExcludeClockHoursForAbsentOnlyScheduleDay
} from '../Scheduling/shiftLeadResolution';
import { buildHybridShiftsForShiftLead } from '../Scheduling/shiftLeadHybridShifts';
import {
  findMatchingShiftForTimecard,
  getPositionLinkedPremiumHoursForTimecard
} from '../Scheduling/positionLinkedPremium';
import { getBusinessTimezoneForPayroll } from './aggregateTimesheetHoursForPayPeriod';

dayjs.extend(utc);
dayjs.extend(timezone);

function roundHours(h) {
  return Math.round(h * 100) / 100;
}

const DEFAULT_SCHEDULING_SETTINGS = {
  shift_lead_enabled: true,
  shift_lead_position: 'Shift Lead',
  shift_lead_mode: 'relative',
  shift_lead_fixed_start: null,
  shift_lead_grace_before_open: 0,
  shift_lead_grace_after_close: 0,
  shift_lead_excluded_positions: ['President / CEO', 'Manager'],
  after_hours_enabled: true,
  after_hours_position: 'After Hours',
  after_hours_mode: 'relative',
  after_hours_fixed_start: null,
  after_hours_grace_after_close: 0
};

function mergeSchedulingSettingsLikeTimesheets(schedulingSettingsRow) {
  const s = schedulingSettingsRow || {};
  return {
    ...DEFAULT_SCHEDULING_SETTINGS,
    ...s,
    shift_lead_excluded_positions:
      s.shift_lead_excluded_positions?.length > 0
        ? s.shift_lead_excluded_positions
        : DEFAULT_SCHEDULING_SETTINGS.shift_lead_excluded_positions
  };
}

function getTimecardDate(timecard, businessTimezone) {
  return dayjs(timecard.clock_in_time).tz(businessTimezone).format('YYYY-MM-DD');
}

function findMatchingShift(timecard, shifts, businessTimezone) {
  return findMatchingShiftForTimecard(timecard, shifts, businessTimezone);
}

function calculateBreakMinutes(breaks) {
  if (!breaks || breaks.length === 0) return 0;
  return breaks.reduce((total, breakItem) => {
    if (breakItem.duration_minutes && !breakItem.is_paid) {
      return total + breakItem.duration_minutes;
    }
    return total;
  }, 0);
}

function mergeIntervalsLocal(intervals) {
  if (!intervals?.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n.start <= cur.end) cur.end = Math.max(cur.end, n.end);
    else {
      out.push(cur);
      cur = { ...n };
    }
  }
  out.push(cur);
  return out;
}

export function buildPaidWorkIntervalsMinutes(timecard, businessTimezone) {
  if (!timecard?.clock_in_time || !timecard?.clock_out_time) return [];
  const ci = dayjs(timecard.clock_in_time).tz(businessTimezone);
  const co = dayjs(timecard.clock_out_time).tz(businessTimezone);
  if (!ci.isValid() || !co.isValid()) return [];
  const toMin = (d) => d.hour() * 60 + d.minute() + d.second() / 60;
  let startM = toMin(ci);
  let endM = toMin(co);
  if (endM <= startM) endM += 24 * 60;
  let intervals = [{ start: startM, end: endM }];
  const breaks = timecard.breaks || [];
  for (const b of breaks) {
    if (b.is_paid || b.break_type === 'paid') continue;
    if (!(b.break_start_at && b.break_end_at)) continue;
    const bs = dayjs(b.break_start_at).tz(businessTimezone);
    const be = dayjs(b.break_end_at).tz(businessTimezone);
    let bsM = toMin(bs);
    let beM = toMin(be);
    if (beM <= bsM) beM += 24 * 60;
    intervals = subtractIntervalFromIntervals(intervals, { start: bsM, end: beM });
  }
  return mergeIntervalsLocal(intervals).filter((i) => i.end > i.start);
}

/** @deprecated use positionLinkedPremium.js — kept for callers importing from this module */
export { findPositionLinkedPremiumRow } from '../Scheduling/positionLinkedPremium';

async function loadEmployeesForShiftLead(businessId) {
  const employeeMap = new Map();

  const { data: buRows, error: buError } = await supabase
    .from('business_users')
    .select(`
      user_id,
      role,
      users!business_users_user_id_fkey (
        id,
        full_name,
        wage,
        position,
        is_active,
        employment_status,
        hire_date
      )
    `)
    .eq('business_id', businessId);

  if (buError) {
    console.warn('[aggregateShiftLeadPremiumHoursForPayPeriod] business_users:', buError.message);
  }

  (buRows || [])
    .filter((entry) => entry.users?.is_active !== false && entry.users?.employment_status !== 'terminated')
    .forEach((entry) => {
      employeeMap.set(entry.users.id, {
        id: entry.users.id,
        full_name: entry.users.full_name,
        wage: parseFloat(entry.users.wage ?? 0),
        position: entry.users.position || null,
        hireDate: entry.users.hire_date || null,
        role: entry.role || 'employee'
      });
    });

  const { data: businessIdUsers, error: bu2Error } = await supabase
    .from('users')
    .select('id, full_name, wage, position, is_active, employment_status, hire_date')
    .eq('business_id', businessId);

  if (bu2Error) {
    console.warn('[aggregateShiftLeadPremiumHoursForPayPeriod] users by business_id:', bu2Error.message);
  }

  (businessIdUsers || [])
    .filter((user) => user.is_active !== false && user.employment_status !== 'terminated')
    .forEach((user) => {
      if (!employeeMap.has(user.id)) {
        employeeMap.set(user.id, {
          id: user.id,
          full_name: user.full_name,
          wage: parseFloat(user.wage ?? 0),
          position: user.position || null,
          hireDate: user.hire_date || null,
          role: 'employee'
        });
      }
    });

  return employeeMap;
}

/**
 * Map aggregation result to `premium_hours` keys (hr_shift_premiums.name) for one employee.
 */
export function mapShiftLeadAggToEmployeePremiumHours(shiftLeadAgg, employeeId, allPremiums) {
  const byPid = shiftLeadAgg?.byEmployeePremiumId || {};
  const namesByPid = shiftLeadAgg?.premiumNamesById || {};
  const perPid = byPid[employeeId];
  if (!perPid) return {};
  const out = {};
  Object.entries(perPid).forEach(([pid, hrs]) => {
    const h = parseFloat(hrs) || 0;
    if (h <= 0) return;
    const name =
      (allPremiums || []).find((p) => String(p.id) === String(pid))?.name ||
      namesByPid[String(pid)] ||
      namesByPid[pid];
    if (!name) return;
    out[name] = (out[name] || 0) + h;
  });
  return out;
}

/**
 * Shift-lead premium hours are not stored in the database. They are derived from
 * `scheduling_time_clocks`, `scheduling_shifts`, breaks, `positions` (incl. `shift_premium_id`),
 * `scheduling_settings`, and `businesses.operating_hours` — the same inputs as Timesheets.
 *
 * @returns {{ byEmployeePremiumId: Record<string, Record<string, number>>, premiumNamesById: Record<string, string>, timezone: string }}
 */
export async function aggregateShiftLeadPremiumHoursForPayPeriod({
  businessId,
  periodStart,
  periodEnd
}) {
  const empty = { byEmployeePremiumId: {}, premiumNamesById: {}, timezone: 'America/Toronto' };
  if (!businessId || !periodStart || !periodEnd) return empty;

  const tz = await getBusinessTimezoneForPayroll(businessId);
  const startUtc = dayjs.tz(`${periodStart}T00:00:00`, tz).utc().toISOString();
  const endUtc = dayjs.tz(`${periodEnd}T23:59:59.999`, tz).utc().toISOString();

  const [
    { data: bizRow },
    { data: ssRow },
    { data: positionsRaw },
    { data: premiumsRows },
    employeeMap
  ] = await Promise.all([
    supabase.from('businesses').select('operating_hours').eq('id', businessId).maybeSingle(),
    supabase.from('scheduling_settings').select('*').eq('business_id', businessId).maybeSingle(),
    supabase
      .from('positions')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('position_name', { ascending: true }),
    supabase
      .from('hr_shift_premiums')
      .select('id, rate, name')
      .eq('business_id', businessId),
    loadEmployeesForShiftLead(businessId)
  ]);

  const operatingHours = bizRow?.operating_hours || null;
  const mergedSchedulingSettings = mergeSchedulingSettingsLikeTimesheets(ssRow);

  const positions = [...(positionsRaw || [])].sort((a, b) => {
    const hasA = a.display_order != null && a.display_order !== '';
    const hasB = b.display_order != null && b.display_order !== '';
    const na = hasA ? Number(a.display_order) : null;
    const nb = hasB ? Number(b.display_order) : null;
    if (na != null && !Number.isNaN(na) && nb != null && !Number.isNaN(nb) && na !== nb) return na - nb;
    if (na != null && !Number.isNaN(na) && (nb == null || Number.isNaN(nb))) return -1;
    if ((na == null || Number.isNaN(na)) && nb != null && !Number.isNaN(nb)) return 1;
    return (a.position_name || '').localeCompare(b.position_name || '', undefined, { sensitivity: 'base' });
  });

  const shiftPremiumRatesById = {};
  /** id → display name (always use when mapping to payroll UI keys) */
  const premiumNamesById = {};
  (premiumsRows || []).forEach((row) => {
    premiumNamesById[String(row.id)] = row.name || 'Shift premium';
    shiftPremiumRatesById[row.id] = {
      rate: parseFloat(row.rate) || 0,
      name: row.name || 'Shift premium'
    };
  });

  const [{ data: shifts, error: shiftsError }, { data: clocks, error: clocksError }] = await Promise.all([
    supabase
      .from('scheduling_shifts')
      .select(
        `
        id,
        business_id,
        employee_id,
        shift_date,
        start_time,
        end_time,
        position,
        status,
        notes,
        break_duration_minutes,
        users!scheduling_shifts_employee_id_fkey (
          id,
          full_name,
          wage,
          position
        )
      `
      )
      .eq('business_id', businessId)
      .gte('shift_date', periodStart)
      .lte('shift_date', periodEnd),
    supabase
      .from('scheduling_time_clocks')
      .select(
        `
        *,
        users!scheduling_time_clocks_employee_id_fkey (
          id,
          full_name,
          wage,
          position
        )
      `
      )
      .eq('business_id', businessId)
      .gte('clock_in_time', startUtc)
      .lte('clock_in_time', endUtc)
      .order('clock_in_time')
  ]);

  if (shiftsError) throw shiftsError;
  if (clocksError) throw clocksError;

  const shiftList = shifts || [];
  const schedulePresence = buildSchedulePresenceByEmployeeDate(shiftList);
  const allClockRows = clocks || [];
  const rawClocks = allClockRows.filter((c) => c.clock_out_time);

  const clockIdsAll = allClockRows.map((c) => c.id).filter(Boolean);
  let breaksByClockId = {};
  if (clockIdsAll.length > 0) {
    const { data: breakRows, error: breakErr } = await supabase
      .from('scheduling_break_tracking')
      .select('*')
      .in('time_clock_id', clockIdsAll)
      .order('break_start_at', { ascending: true });
    if (breakErr) {
      console.warn('[aggregateShiftLeadPremiumHoursForPayPeriod] breaks:', breakErr.message);
    } else {
      breaksByClockId = (breakRows || []).reduce((acc, b) => {
        const id = b.time_clock_id;
        if (!acc[id]) acc[id] = [];
        acc[id].push(b);
        return acc;
      }, {});
    }
  }

  const timecardsForHybrid = allClockRows.map((tc) => ({
    ...tc,
    scheduled_shift: findMatchingShift(tc, shiftList, tz),
    breaks: breaksByClockId[tc.id] || [],
    is_scheduled_placeholder: false
  }));

  const timecards = rawClocks.map((tc) => ({
    ...tc,
    scheduled_shift: findMatchingShift(tc, shiftList, tz),
    breaks: breaksByClockId[tc.id] || [],
    is_scheduled_placeholder: false
  }));

  const shiftsForShiftLeadResolution = buildHybridShiftsForShiftLead(
    timecardsForHybrid,
    shiftList,
    periodStart,
    periodEnd,
    tz,
    operatingHours
  );

  const employeeById = employeeMap;

  const shiftLeadWinnerByDate = {};
  let cur = dayjs(periodStart);
  const endD = dayjs(periodEnd);
  while (cur.valueOf() <= endD.valueOf()) {
    const key = cur.format('YYYY-MM-DD');
    const dayShifts = shiftsForShiftLeadResolution.filter((s) => s.shift_date === key);
    shiftLeadWinnerByDate[key] = resolveShiftLeadForDay({
      day: cur,
      shifts: dayShifts,
      employeeById,
      positions,
      schedulingSettings: mergedSchedulingSettings,
      businessHours: operatingHours
    });
    cur = cur.add(1, 'day');
  }

  const byEmployeePremiumId = {};
  const keyChainActive = (positions || []).some((p) => p.shift_lead_eligible === true);

  for (const timecard of timecards) {
    if (!timecard.clock_out_time) continue;

    const dateKey = getTimecardDate(timecard, tz);
    if (shouldExcludeClockHoursForAbsentOnlyScheduleDay(timecard.employee_id, dateKey, schedulePresence)) {
      continue;
    }

    const employee =
      employeeById.get(timecard.employee_id) ||
      (timecard.users
        ? {
            id: timecard.users.id,
            full_name: timecard.users.full_name,
            position: timecard.users.position || null,
            hireDate: null,
            role: 'employee'
          }
        : null);
    if (!employee) continue;

    const positionName =
      timecard.scheduled_shift?.position || timecard.position || timecard.users?.position || '';
    const win = shiftLeadWinnerByDate[dateKey];

    const day = dayjs.tz(`${dateKey}T12:00:00`, tz);
    const dayShifts = shiftsForShiftLeadResolution.filter((s) => s.shift_date === dateKey);
    const breaks = timecard.breaks || [];
    const unpaidBreaks = breaks.filter((b) => !b.is_paid && b.break_type !== 'paid');
    const allUnpaidHaveTimes =
      unpaidBreaks.length === 0 || unpaidBreaks.every((b) => b.break_start_at && b.break_end_at);

    let payableMin = 0;
    if (allUnpaidHaveTimes) {
      payableMin = getShiftLeadPremiumPayableMinutes({
        day,
        shifts: dayShifts,
        employeeById,
        positions,
        schedulingSettings: mergedSchedulingSettings,
        businessHours: operatingHours,
        employeeId: employee.id,
        clockedPositionName: positionName,
        paidWorkIntervalsMinutes: buildPaidWorkIntervalsMinutes(timecard, tz)
      });
    } else {
      const ci = dayjs(timecard.clock_in_time).tz(tz);
      const co = dayjs(timecard.clock_out_time).tz(tz);
      const toMin = (d) => d.hour() * 60 + d.minute() + d.second() / 60;
      let startM = toMin(ci);
      let endM = toMin(co);
      if (endM <= startM) endM += 24 * 60;
      const grossOverlapMin = getShiftLeadPremiumPayableMinutes({
        day,
        shifts: dayShifts,
        employeeById,
        positions,
        schedulingSettings: mergedSchedulingSettings,
        businessHours: operatingHours,
        employeeId: employee.id,
        clockedPositionName: positionName,
        paidWorkIntervalsMinutes: [{ start: startM, end: endM }]
      });
      const grossMin = endM - startM;
      const paidMin = Math.max(0, grossMin - calculateBreakMinutes(breaks));
      payableMin = grossMin > 0 ? grossOverlapMin * (paidMin / grossMin) : 0;
    }

    const payableHours = payableMin / 60;
    if (payableHours <= 0) continue;

    const premiumPositionRow = keyChainActive
      ? getShiftLeadPremiumRateRowForKeyChainEmployee({
          employeeId: employee.id,
          dayShifts,
          employeeById,
          positions
        })
      : findShiftLeadPremiumPositionRow(win, positionName, positions, mergedSchedulingSettings);
    const pid = premiumPositionRow?.shift_premium_id;
    if (pid == null) continue;

    const pidKey = String(pid);

    const empId = employee.id;
    if (!byEmployeePremiumId[empId]) byEmployeePremiumId[empId] = {};
    byEmployeePremiumId[empId][pidKey] =
      (byEmployeePremiumId[empId][pidKey] || 0) + payableHours;
  }

  // Position-linked premiums (e.g. Day Camp Director): paid hours per scheduled role segment.
  for (const timecard of timecards) {
    if (!timecard.clock_out_time) continue;

    const dateKey = getTimecardDate(timecard, tz);
    if (shouldExcludeClockHoursForAbsentOnlyScheduleDay(timecard.employee_id, dateKey, schedulePresence)) {
      continue;
    }

    const employee =
      employeeById.get(timecard.employee_id) ||
      (timecard.users
        ? {
            id: timecard.users.id,
            full_name: timecard.users.full_name,
            position: timecard.users.position || null,
            hireDate: null,
            role: 'employee'
          }
        : null);
    if (!employee) continue;

    const perPid = getPositionLinkedPremiumHoursForTimecard({
      timecard,
      scheduledShifts: shiftList,
      positions,
      businessTimezone: tz,
      paidWorkIntervalsMinutes: buildPaidWorkIntervalsMinutes(timecard, tz)
    });

    const empId = employee.id;
    Object.entries(perPid).forEach(([pidKey, hrs]) => {
      const h = parseFloat(hrs) || 0;
      if (h <= 0) return;
      if (!byEmployeePremiumId[empId]) byEmployeePremiumId[empId] = {};
      byEmployeePremiumId[empId][pidKey] = (byEmployeePremiumId[empId][pidKey] || 0) + h;
    });
  }

  const byEmployeePremiumIdRounded = {};
  Object.keys(byEmployeePremiumId).forEach((id) => {
    const row = byEmployeePremiumId[id];
    byEmployeePremiumIdRounded[id] = {};
    Object.keys(row).forEach((pidKey) => {
      byEmployeePremiumIdRounded[id][pidKey] = roundHours(row[pidKey]);
    });
  });

  return {
    byEmployeePremiumId: byEmployeePremiumIdRounded,
    premiumNamesById,
    timezone: tz
  };
}
