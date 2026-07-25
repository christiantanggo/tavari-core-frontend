/**
 * @param {unknown} value
 * @returns {string} YYYY-MM-DD or ''
 */
function toYmd(value) {
  if (value == null || value === '') return '';
  const s = typeof value === 'string' ? value : String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

/**
 * Whether an employee should appear for the pay period being run.
 *
 * - Non-terminated: always included.
 * - Terminated: included if `termination_date` is **on or after** `payPeriodStart`
 *   (i.e. they were not already terminated before this period). This covers
 *   termination during the period or after the period end.
 * - Terminated with no `termination_date`: included (treat as needs final pay until date is set).
 *
 * @param {object} emp
 * @param {string} [emp.employment_status]
 * @param {string} [emp.termination_date]
 * @param {string} payPeriodStart — YYYY-MM-DD
 * @param {string} [payPeriodEnd] — reserved for future rules; not required for current logic
 * @returns {boolean}
 */
export function isPayrollVisibleForPeriod(emp, payPeriodStart, _payPeriodEnd) {
  if (!emp) return false;
  const status = String(emp.employment_status || '').toLowerCase();
  if (status !== 'terminated') return true;

  const start = toYmd(payPeriodStart);
  if (!start) return false;

  const term = toYmd(emp.termination_date);
  if (!term) return true;

  return term >= start;
}

export { toYmd };
