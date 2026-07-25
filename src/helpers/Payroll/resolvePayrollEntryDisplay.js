import { computeAutoLieuForPeriod } from './computeAutoLieuForPeriod';

/**
 * Normalize hours/pay fields for payroll entry UI (list + totals).
 * Edit Payroll often shows regular_hours + lieu_hours while Entry list used
 * only total_hours — when total_hours is 0 but regular/lieu are set, show the
 * meaningful worked/paid picture instead of blank zeros.
 */
export function effectiveWorkedHours(entry) {
  if (!entry) return 0;
  const total = parseFloat(entry.total_hours);
  if (!Number.isNaN(total) && total > 0) return total;

  const regular = parseFloat(entry.regular_hours) || 0;
  const overtime = parseFloat(entry.overtime_hours) || 0;
  const lieu = parseFloat(entry.lieu_hours) || 0;
  const stat = parseFloat(entry.stat_holiday_hours) || 0;
  const sum = regular + overtime + lieu + stat;
  return sum > 0 ? sum : 0;
}

/** Cash-compensation hours for lieu-capped employees (excludes banked lieu earned). */
export function effectivePaidHours(entry, employee = null, memoryHours = null) {
  const worked = effectiveWorkedHours(entry);
  if (!employee?.lieu_time_enabled) return worked;

  const maxPaid = parseFloat(employee.max_paid_hours_per_period) || 0;
  if (maxPaid <= 0) return worked;

  const lieuEarned = parseFloat(entry?.lieu_earned) || 0;
  const regularPaid = parseFloat(entry?.regular_hours) || 0;
  const lieuUsed =
    parseFloat(entry?.lieu_hours) ||
    parseFloat(entry?.lieu_used) ||
    0;
  const ot = parseFloat(entry?.overtime_hours) || 0;
  const stat = parseFloat(entry?.stat_holiday_hours) || 0;

  if (lieuEarned > 0) {
    return maxPaid;
  }

  const componentSum = regularPaid + lieuUsed + ot + stat;
  if (componentSum > 0) {
    return Math.min(componentSum, maxPaid);
  }

  const mem = memoryHours || {};
  const wage = parseFloat(employee.wage || employee.effective_wage) || 0;
  const holidayPayAmount = parseFloat(mem.holiday_pay) || parseFloat(entry?.holiday_pay) || 0;
  const auto = computeAutoLieuForPeriod({
    employee,
    totalWorkedHours: worked,
    statHolidayHours: parseFloat(mem.stat_worked_hours) || stat,
    holidayPayAmount,
    wage,
  });
  if (auto.lieuEarned > 0) {
    return maxPaid;
  }

  return Math.min(worked, maxPaid);
}

export function mergePayrollEntryDisplay(dbEntry, memoryHours, snapshot, employee = null) {
  const fromDb = dbEntry || {};
  const fromMem = memoryHours || {};
  const fromSnap = snapshot || {};

  const total_hours =
    parseFloat(fromSnap.total_hours) ||
    parseFloat(fromMem.total_hours) ||
    effectiveWorkedHours(fromDb);

  const firstNum = (...vals) => {
    for (const v of vals) {
      if (v === undefined || v === null || v === '') continue;
      const n = parseFloat(v);
      if (!Number.isNaN(n)) return n;
    }
    return 0;
  };

  const lieu_used = firstNum(
    fromSnap.lieu_used,
    fromSnap.lieu_hours,
    fromMem.lieu_used,
    fromDb.lieu_hours
  );

  const lieu_earned = firstNum(
    fromSnap.lieu_earned,
    fromMem.lieu_earned,
    fromDb.lieu_earned
  );

  const lieu_pay = firstNum(
    fromSnap.lieu_pay,
    fromMem.lieu_pay,
    fromDb.lieu_pay,
    Array.isArray(fromDb.wage_breakdown)
      ? fromDb.wage_breakdown.reduce((sum, period) => sum + (parseFloat(period?.lieu_pay) || 0), 0)
      : 0
  );

  const gross_pay = firstNum(fromSnap.gross_pay, fromDb.gross_pay);

  const net_pay = firstNum(fromSnap.net_pay, fromDb.net_pay);

  const additional_tax = firstNum(fromSnap.additional_tax, fromDb.additional_tax);

  const hours_worked = total_hours;
  const hours_paid = effectivePaidHours(
    {
      ...fromDb,
      total_hours: hours_worked,
      lieu_earned,
      lieu_hours: lieu_used,
      lieu_used,
      regular_hours: fromDb.regular_hours,
      overtime_hours: fromDb.overtime_hours,
      stat_holiday_hours: fromDb.stat_holiday_hours,
      holiday_pay: fromMem.holiday_pay ?? fromDb.holiday_pay,
    },
    employee,
    fromMem
  );

  const hasEntry =
    !!dbEntry?.user_id ||
    !!fromSnap.user_id ||
    hours_worked > 0 ||
    lieu_used > 0 ||
    lieu_earned > 0 ||
    net_pay > 0;

  return {
    total_hours: hours_worked,
    hours_worked,
    hours_paid,
    lieu_used,
    lieu_earned,
    lieu_pay,
    gross_pay,
    net_pay,
    additional_tax,
    hasEntry,
    hasHours: hours_worked > 0 || lieu_used > 0,
  };
}
