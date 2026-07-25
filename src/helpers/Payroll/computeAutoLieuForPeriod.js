import { resolveAvailableLieuBalance, clampLieuHoursForPeriod } from './lieuTimeLedger';

/**
 * Auto lieu earned/used for a pay period based on max paid hours and current balance.
 * Used by payroll entry modal and schedule-import preview so logic stays consistent.
 *
 * Lieu is only USED when the employee has a positive balance — never auto-fill from debt.
 */
export function computeAutoLieuForPeriod({
  employee,
  totalWorkedHours = 0,
  statHolidayHours = 0,
  holidayPayAmount = 0,
  wage = null,
}) {
  const baseWage =
    wage != null
      ? parseFloat(wage)
      : parseFloat(employee?.wage || employee?.effective_wage || 0);
  const currentBalance = resolveAvailableLieuBalance(employee);
  const empty = {
    lieuEarned: 0,
    lieuUsed: 0,
    lieuBalanceAfter: currentBalance,
    totalCompensationHours: 0,
    maxHours: 0,
  };

  if (!employee?.lieu_time_enabled) {
    return empty;
  }

  const maxHours = parseFloat(employee.max_paid_hours_per_period || 0);
  if (maxHours <= 0) {
    return { ...empty, maxHours: 0 };
  }

  const holidayPayHours =
    holidayPayAmount > 0 && baseWage > 0 ? holidayPayAmount / baseWage : 0;
  const totalCompensationHours =
    (parseFloat(totalWorkedHours) || 0) +
    (parseFloat(statHolidayHours) || 0) +
    holidayPayHours;

  let lieuEarned = 0;
  let lieuUsed = 0;

  if (totalCompensationHours > maxHours) {
    lieuEarned = totalCompensationHours - maxHours;
  } else if (currentBalance > 0) {
    const shortfall = maxHours - totalCompensationHours;
    lieuUsed = Math.min(shortfall, currentBalance);
  }

  const clamped = clampLieuHoursForPeriod({
    employee,
    lieuEarned,
    lieuUsed,
    balanceBefore: currentBalance
  });

  return {
    lieuEarned: clamped.lieuEarned,
    lieuUsed: clamped.lieuUsed,
    lieuBalanceAfter: clamped.lieuBalanceAfter,
    totalCompensationHours,
    maxHours
  };
}

/**
 * Apply auto lieu to a payroll preview and recalculate pay dollars (gross, vacation,
 * deductions, net). The payroll hook may return lieu hours without matching pay when
 * balance/max-hours were evaluated differently than our shared auto-lieu helper.
 *
 * Always overwrites lieu fields from computeAutoLieuForPeriod when lieu is enabled.
 */
export function applyLieuToPayrollPreview(employee, hours, preview, options = {}) {
  if (!employee?.lieu_time_enabled || !preview) return preview;

  const wage = parseFloat(employee.wage || 0);
  const holidayPayAmount = parseFloat(options.holidayPayAmount) || 0;

  const auto = computeAutoLieuForPeriod({
    employee,
    totalWorkedHours: hours?.total_hours,
    statHolidayHours: options.statHolidayHours ?? hours?.stat_worked_hours ?? 0,
    holidayPayAmount,
  });

  const lieuUsed = auto.lieuUsed;
  const lieuEarned = auto.lieuEarned;
  const clamped = clampLieuHoursForPeriod({
    employee,
    lieuEarned,
    lieuUsed,
    balanceBefore: resolveAvailableLieuBalance(employee)
  });
  const safeLieuUsed = clamped.lieuUsed;
  const safeLieuEarned = clamped.lieuEarned;
  const lieuPay = safeLieuUsed * wage;

  const priorGross = parseFloat(preview.gross_pay) || 0;
  const priorLieuPay = parseFloat(preview.lieu_pay) || 0;
  const priorVacation = parseFloat(preview.vacation_pay) || 0;
  const priorDeductions = parseFloat(preview.total_deductions) || 0;
  const priorNet = parseFloat(preview.net_pay);
  const priorHoliday = holidayPayAmount;

  const newGross = Math.max(0, priorGross - priorLieuPay + lieuPay);
  const vacationRate = priorGross > 0 ? priorVacation / priorGross : 0.04;
  const newVacation = newGross * vacationRate;

  const priorIncome = priorGross + priorVacation + priorHoliday;
  const newIncome = newGross + newVacation + priorHoliday;
  const incomeDelta = newIncome - priorIncome;

  let newDeductions = priorDeductions;
  let newNet =
    typeof priorNet === 'number' && !Number.isNaN(priorNet)
      ? priorNet
      : Math.max(0, priorIncome - priorDeductions);

  if (Math.abs(incomeDelta) > 0.001) {
    const marginalRate = priorIncome > 0 ? priorDeductions / priorIncome : 0.22;
    newDeductions = priorDeductions + incomeDelta * marginalRate;
    newNet = Math.max(0, newIncome - newDeductions);
  } else if (Math.abs(lieuPay - priorLieuPay) > 0.001) {
    newNet = Math.max(0, newIncome - newDeductions);
  }

  return {
    ...preview,
    lieu_used: safeLieuUsed,
    lieu_earned: safeLieuEarned,
    lieu_hours: safeLieuUsed,
    lieu_pay: lieuPay,
    lieu_balance_before: clamped.lieuBalanceBefore,
    lieu_balance_after: clamped.lieuBalanceAfter,
    lieu_balance: clamped.lieuBalanceAfter,
    gross_pay: newGross,
    vacation_pay: newVacation,
    total_deductions: newDeductions,
    net_pay: newNet,
  };
}

/** @deprecated Use applyLieuToPayrollPreview */
export function mergeAutoLieuIntoPreview(employee, hours, preview, options = {}) {
  return applyLieuToPayrollPreview(employee, hours, preview, options);
}
