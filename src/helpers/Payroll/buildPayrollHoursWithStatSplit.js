function roundHours(h) {
  return Math.round(parseFloat(h) * 100) / 100;
}

/**
 * Split gross timesheet hours into non-stat total_hours + stat_worked_hours for payroll entry.
 * total_hours in payroll should exclude stat holiday hours (they are entered separately at 1.5×).
 */
export function buildPayrollHoursWithStatSplit({ grossTotalHours, statWorkedHours }) {
  const stat = roundHours(parseFloat(statWorkedHours) || 0);
  const gross = roundHours(parseFloat(grossTotalHours) || 0);
  const nonStat = roundHours(Math.max(0, gross - stat));
  return {
    total_hours: nonStat,
    stat_worked_hours: stat
  };
}
