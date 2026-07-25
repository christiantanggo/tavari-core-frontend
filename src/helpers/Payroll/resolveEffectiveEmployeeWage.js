/**
 * When users.wage is null/0, payroll must not treat the employee as unpaid.
 * Fall back to the latest hrpayroll_wage_history row for the business.
 */
export function resolveEffectiveEmployeeWage(employee, latestWageByUserId = {}) {
  const profileWage = parseFloat(employee?.wage);
  if (!Number.isNaN(profileWage) && profileWage > 0) {
    return profileWage;
  }

  const fromHistory = parseFloat(latestWageByUserId[employee?.id]);
  if (!Number.isNaN(fromHistory) && fromHistory > 0) {
    return fromHistory;
  }

  const fromEffective = parseFloat(employee?.effective_wage);
  if (!Number.isNaN(fromEffective) && fromEffective > 0) {
    return fromEffective;
  }

  return 0;
}

/** Pick the latest new_wage per user_id from wage history rows (already sorted desc). */
export function indexLatestWagesFromHistory(wageHistoryRows = []) {
  const map = {};
  for (const row of wageHistoryRows) {
    if (!row?.user_id || map[row.user_id] !== undefined) continue;
    const w = parseFloat(row.new_wage);
    if (!Number.isNaN(w) && w > 0) {
      map[row.user_id] = w;
    }
  }
  return map;
}
