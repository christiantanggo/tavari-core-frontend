import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { supabase } from '../../supabaseClient';
import { getBusinessTimezoneForPayroll } from './aggregateTimesheetHoursForPayPeriod';
import { buildPaidWorkIntervalsMinutes } from './aggregateShiftLeadPremiumHoursForPayPeriod';
import {
  mergeIntervals,
  totalMinutes,
  splitLinearPaidIntervalsToDailyPieces,
  qualifyPaidDayPiece,
  resolveExclusiveClusterGreedy
} from './premiumIntervalMath';

dayjs.extend(utc);
dayjs.extend(timezone);

function roundHours(h) {
  return Math.round(parseFloat(h) * 100) / 100;
}

/**
 * Hours per premium **name** for `applies_to === 'all_hours'` assignments, respecting
 * time_application_mode, operating hours + buffers, and exclusive_cluster stacking.
 *
 * @returns {Record<string, Record<string, number>>} user_id -> premium_name -> hours
 */
export async function aggregateConfigurablePremiumHoursForPayPeriod({
  businessId,
  periodStart,
  periodEnd
}) {
  const empty = {};
  if (!businessId || !periodStart || !periodEnd) return empty;

  const tz = await getBusinessTimezoneForPayroll(businessId);
  const startUtc = dayjs.tz(`${periodStart}T00:00:00`, tz).utc().toISOString();
  const endUtc = dayjs.tz(`${periodEnd}T23:59:59.999`, tz).utc().toISOString();

  const [{ data: bizRow }, { data: premiumsRows }, { data: clocks }, { data: assignments }] =
    await Promise.all([
      supabase.from('businesses').select('operating_hours').eq('id', businessId).maybeSingle(),
      supabase
        .from('hr_shift_premiums')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true),
      supabase
        .from('scheduling_time_clocks')
        .select('*')
        .eq('business_id', businessId)
        .gte('clock_in_time', startUtc)
        .lte('clock_in_time', endUtc)
        .order('clock_in_time'),
      supabase
        .from('hrpayroll_employee_premiums')
        .select('user_id, premium_name, premium_rate, applies_to_all_hours, is_active')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .eq('applies_to_all_hours', true)
    ]);

  const operatingHours = bizRow?.operating_hours || null;
  const premiumDefs = (premiumsRows || []).filter((p) => p.applies_to === 'all_hours');
  const premiumByName = Object.fromEntries(premiumDefs.map((p) => [p.name, p]));

  const clocksRaw = (clocks || []).filter((c) => c.clock_out_time);
  const clockIds = clocksRaw.map((c) => c.id).filter(Boolean);
  let breaksByClockId = {};
  if (clockIds.length > 0) {
    const { data: breakRows } = await supabase
      .from('scheduling_break_tracking')
      .select('*')
      .in('time_clock_id', clockIds)
      .order('break_start_at', { ascending: true });
    breaksByClockId = (breakRows || []).reduce((acc, b) => {
      const id = b.time_clock_id;
      if (!acc[id]) acc[id] = [];
      acc[id].push(b);
      return acc;
    }, {});
  }

  /** userId -> premiumName -> interval list */
  const rawIntervalsByUser = {};

  const assignedRows = assignments || [];
  for (const tc of clocksRaw) {
    const empId = tc.employee_id;
    if (!empId) continue;

    const userAssignments = assignedRows.filter((a) => a.user_id === empId);
    if (userAssignments.length === 0) continue;

    const timecard = { ...tc, breaks: breaksByClockId[tc.id] || [] };
    const paidLinear = buildPaidWorkIntervalsMinutes(timecard, tz);
    if (!paidLinear?.length) continue;

    const clockInDateKey = dayjs(tc.clock_in_time).tz(tz).format('YYYY-MM-DD');
    const dailyPieces = splitLinearPaidIntervalsToDailyPieces(paidLinear, clockInDateKey, tz);

    for (const asn of userAssignments) {
      const name = asn.premium_name;
      const def = premiumByName[name];
      if (!def || def.applies_to !== 'all_hours') continue;

      if (!rawIntervalsByUser[empId]) rawIntervalsByUser[empId] = {};
      if (!rawIntervalsByUser[empId][name]) rawIntervalsByUser[empId][name] = [];

      for (const piece of dailyPieces) {
        const q = qualifyPaidDayPiece(piece, def, operatingHours, tz);
        if (q?.length) {
          rawIntervalsByUser[empId][name].push(...q);
        }
      }
    }
  }

  const rateByUserAndName = {};
  assignedRows.forEach((a) => {
    if (!a.user_id || !a.premium_name) return;
    const k = `${a.user_id}::${a.premium_name}`;
    rateByUserAndName[k] = parseFloat(a.premium_rate) || 0;
  });

  const assignmentsByUser = {};
  assignedRows.forEach((a) => {
    if (!a.user_id || !a.premium_name) return;
    if (!assignmentsByUser[a.user_id]) assignmentsByUser[a.user_id] = [];
    assignmentsByUser[a.user_id].push(a);
  });

  const out = {};

  Object.keys(assignmentsByUser).forEach((empId) => {
    const userAssign = assignmentsByUser[empId];
    const byName = rawIntervalsByUser[empId] || {};

    const mergedRaw = {};
    Object.keys(byName).forEach((name) => {
      mergedRaw[name] = mergeIntervals(byName[name]);
    });

    const exclusiveKeys = new Set();
    premiumDefs.forEach((d) => {
      if (d.stacking_behavior === 'exclusive_cluster' && d.exclusive_cluster_key) {
        exclusiveKeys.add(d.exclusive_cluster_key);
      }
    });

    const finalIntervals = { ...mergedRaw };

    exclusiveKeys.forEach((clusterKey) => {
      const memberNames = premiumDefs
        .filter(
          (d) =>
            d.exclusive_cluster_key === clusterKey && d.stacking_behavior === 'exclusive_cluster'
        )
        .map((d) => d.name)
        .filter((n) => mergedRaw[n]?.length);

      if (memberNames.length <= 1) return;

      const rates = {};
      memberNames.forEach((n) => {
        rates[n] = rateByUserAndName[`${empId}::${n}`] ?? premiumByName[n]?.rate ?? 0;
      });

      const subset = {};
      memberNames.forEach((n) => {
        subset[n] = mergedRaw[n] || [];
      });

      const resolved = resolveExclusiveClusterGreedy(subset, rates, memberNames);
      Object.assign(finalIntervals, resolved);
    });

    const hoursMap = {};
    userAssign.forEach((a) => {
      const name = a.premium_name;
      if (!premiumByName[name]) return;
      const h = totalMinutes(finalIntervals[name] || []) / 60;
      hoursMap[name] = roundHours(h);
    });

    if (Object.keys(hoursMap).length > 0) out[empId] = hoursMap;
  });

  return out;
}
