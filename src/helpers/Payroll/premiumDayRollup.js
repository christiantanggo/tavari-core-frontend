import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { buildPaidWorkIntervalsMinutes } from './aggregateShiftLeadPremiumHoursForPayPeriod';
import {
  mergeIntervals,
  intersectIntervals,
  totalMinutes,
  splitLinearPaidIntervalsToDailyPieces,
  qualifyPaidDayPiece,
  resolveExclusiveClusterGreedy
} from './premiumIntervalMath';

dayjs.extend(utc);
dayjs.extend(timezone);

function roundH(h) {
  return Math.round(parseFloat(h) * 100) / 100;
}

/**
 * Hours per assigned premium for **this** timecard, using same-day sibling punches
 * for exclusive-cluster resolution (shift lead vs after-hours style).
 *
 * @param {object} params
 * @param {object} params.timecard — scheduling_time_clocks row + breaks[]
 * @param {object[]} params.siblingTimecardsSameEmployeeDay — same employee_id + calendar date (local)
 * @param {object|null} params.operatingHours
 * @param {string} params.tz
 * @param {Record<string, object>} params.premiumByName — hr_shift_premiums by name
 * @param {object[]} params.assignmentsForEmployee — hrpayroll_employee_premiums rows for this user (applies_to_all_hours)
 * @returns {Record<string, number>} premium_name -> hours attributable to this punch
 */
export function computePremiumHoursForTimecardWithDayExclusive({
  timecard,
  siblingTimecardsSameEmployeeDay,
  operatingHours,
  tz,
  premiumByName,
  assignmentsForEmployee
}) {
  const out = {};
  if (!timecard?.clock_in_time || !timecard?.clock_out_time) return out;

  const applicableAssign = (assignmentsForEmployee || []).filter(
    (a) => a.applies_to_all_hours !== false && a.is_active !== false
  );
  if (applicableAssign.length === 0) return out;

  const siblings = (siblingTimecardsSameEmployeeDay || []).filter(
    (tc) => tc.clock_in_time && tc.clock_out_time
  );
  if (siblings.length === 0) return out;

  const mergedPaid = mergeIntervals(
    siblings.flatMap((tc) => buildPaidWorkIntervalsMinutes(tc, tz) || [])
  );
  if (!mergedPaid.length) return out;

  const clockInDateKey = dayjs(timecard.clock_in_time).tz(tz).format('YYYY-MM-DD');
  const dailyPieces = splitLinearPaidIntervalsToDailyPieces(mergedPaid, clockInDateKey, tz);

  const premiumDefs = applicableAssign
    .map((a) => premiumByName[a.premium_name])
    .filter(Boolean);

  const rawByName = {};
  applicableAssign.forEach((asn) => {
    const def = premiumByName[asn.premium_name];
    if (!def || def.applies_to !== 'all_hours') return;
    rawByName[asn.premium_name] = [];
  });

  dailyPieces.forEach((piece) => {
    applicableAssign.forEach((asn) => {
      const def = premiumByName[asn.premium_name];
      if (!def || def.applies_to !== 'all_hours') return;
      const q = qualifyPaidDayPiece(piece, def, operatingHours, tz);
      if (q?.length) rawByName[asn.premium_name].push(...q);
    });
  });

  const mergedRaw = {};
  Object.keys(rawByName).forEach((name) => {
    mergedRaw[name] = mergeIntervals(rawByName[name]);
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
      const asn = applicableAssign.find((a) => a.premium_name === n);
      rates[n] = parseFloat(asn?.premium_rate) ?? parseFloat(premiumByName[n]?.rate) ?? 0;
    });

    const subset = {};
    memberNames.forEach((n) => {
      subset[n] = mergedRaw[n] || [];
    });

    const resolved = resolveExclusiveClusterGreedy(subset, rates, memberNames);
    Object.assign(finalIntervals, resolved);
  });

  const selfPaid = buildPaidWorkIntervalsMinutes(timecard, tz);

  applicableAssign.forEach((asn) => {
    const name = asn.premium_name;
    const def = premiumByName[name];
    if (!def || def.applies_to !== 'all_hours') return;
    const fin = mergeIntervals(finalIntervals[name] || []);
    const attributed = intersectIntervals(fin, selfPaid);
    const h = totalMinutes(attributed) / 60;
    out[name] = roundH(h);
  });

  return out;
}
