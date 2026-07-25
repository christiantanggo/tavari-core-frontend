import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { supabase as defaultSupabase } from '../../supabaseClient';
import { getBusinessTimezoneForPayroll } from './aggregateTimesheetHoursForPayPeriod';
import { getCanadianStatHolidaysForPeriod } from '../../utils/canadianStatHolidays';

dayjs.extend(utc);
dayjs.extend(timezone);

function round2(n) {
  return Math.round(parseFloat(n) * 100) / 100;
}

function regularWagesFromEntry(entry, employeeWage) {
  let regularPay = 0;
  let lieuPayOut = 0;
  const wage = parseFloat(employeeWage) || 0;

  try {
    if (entry.wage_breakdown) {
      const wageBreakdown =
        typeof entry.wage_breakdown === 'string'
          ? JSON.parse(entry.wage_breakdown)
          : entry.wage_breakdown;
      if (Array.isArray(wageBreakdown)) {
        wageBreakdown.forEach((period) => {
          if (period.is_lieu_payment) {
            lieuPayOut += parseFloat(period.lieu_pay || 0);
          } else {
            regularPay += parseFloat(period.regular_pay || period.pay || 0);
          }
        });
      }
    }
  } catch {
    // fall through
  }

  if (regularPay === 0 && entry.regular_hours) {
    regularPay = parseFloat(entry.regular_hours || 0) * wage;
  }
  if (entry.lieu_hours && parseFloat(entry.lieu_hours) > 0) {
    lieuPayOut += parseFloat(entry.lieu_hours) * wage;
  }

  return {
    regularPay,
    lieuPayOut,
    vacationPay: parseFloat(entry.vacation_pay || 0)
  };
}

export async function fetchHolidayPayrollHistory({
  employeeId,
  businessId,
  holidayDate,
  supabase = defaultSupabase
}) {
  if (!employeeId || !businessId || !holidayDate) return [];

  const { data: payrollSettings } = await supabase
    .from('hrpayroll_settings')
    .select('pay_frequency')
    .eq('business_id', businessId)
    .maybeSingle();

  const payFrequency = payrollSettings?.pay_frequency || 'bi_weekly';
  const holidayEnd = dayjs(holidayDate).format('YYYY-MM-DD');

  const [{ data: regularEntries }, { data: migrationEntries }] = await Promise.all([
    supabase
      .from('hrpayroll_entries')
      .select(`
        *,
        hrpayroll_runs!inner(pay_period_start, pay_period_end, pay_date, business_id, status)
      `)
      .eq('user_id', employeeId)
      .eq('hrpayroll_runs.business_id', businessId)
      .in('hrpayroll_runs.status', ['finalized', 'edited'])
      .lt('hrpayroll_runs.pay_period_end', holidayEnd)
      .not('payroll_run_id', 'is', null)
      .order('hrpayroll_runs(pay_period_end)', { ascending: false }),
    supabase
      .from('hrpayroll_entries')
      .select('*')
      .eq('user_id', employeeId)
      .eq('business_id', businessId)
      .is('payroll_run_id', null)
      .lt('period_end_date', holidayEnd)
      .order('period_end_date', { ascending: false })
  ]);

  const periodsNeeded =
    payFrequency === 'weekly'
      ? 4
      : payFrequency === 'bi_weekly'
        ? 2
        : payFrequency === 'semi_monthly'
          ? 2
          : payFrequency === 'monthly'
            ? 1
            : 2;

  const allAvailableEntries = [...(regularEntries || []), ...(migrationEntries || [])].sort(
    (a, b) => {
      const dateA = new Date(a.hrpayroll_runs?.pay_period_end || a.period_end_date);
      const dateB = new Date(b.hrpayroll_runs?.pay_period_end || b.period_end_date);
      return dateB - dateA;
    }
  );

  return allAvailableEntries.slice(0, periodsNeeded);
}

/**
 * True if this employee already received public holiday pay for a holiday whose date
 * falls inside another payroll run (finalized/edited, or another draft when excludeRunId set).
 */
export async function hasHolidayPayAlreadyBeenPaid({
  employeeId,
  businessId,
  holidayDate,
  excludePayrollRunId = null,
  supabase = defaultSupabase
}) {
  if (!employeeId || !businessId || !holidayDate) return false;

  const holidayKey = String(holidayDate).slice(0, 10);

  let query = supabase
    .from('hrpayroll_entries')
    .select(`
      id,
      holiday_pay,
      payroll_run_id,
      hrpayroll_runs!inner(id, pay_period_start, pay_period_end, status, business_id)
    `)
    .eq('user_id', employeeId)
    .eq('hrpayroll_runs.business_id', businessId)
    .gt('holiday_pay', 0)
    .in('hrpayroll_runs.status', ['finalized', 'edited', 'draft'])
    .lte('hrpayroll_runs.pay_period_start', holidayKey)
    .gte('hrpayroll_runs.pay_period_end', holidayKey);

  if (excludePayrollRunId) {
    query = query.neq('payroll_run_id', excludePayrollRunId);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[hasHolidayPayAlreadyBeenPaid]', error);
    return false;
  }

  return (data || []).some((row) => parseFloat(row.holiday_pay) > 0);
}

export function calculateHolidayPayAmount({
  employee,
  jurisdiction = 'ON',
  payrollHistory = [],
  missedShiftBefore = false,
  missedShiftAfter = false
}) {
  if (missedShiftBefore || missedShiftAfter) {
    return {
      amount: 0,
      isEligible: false,
      method: 'Disqualified — missed shift before/after holiday'
    };
  }

  const wage = parseFloat(employee?.wage || 0);
  const j = String(jurisdiction || 'ON').toUpperCase();

  if (j === 'ON' || j === 'FEDERAL') {
    if (payrollHistory.length > 0) {
      const totalRegularWages = payrollHistory.reduce((sum, entry) => {
        const { regularPay, lieuPayOut, vacationPay } = regularWagesFromEntry(entry, wage);
        return sum + regularPay + lieuPayOut + vacationPay;
      }, 0);
      const amount = round2(totalRegularWages / 20);
      return {
        amount,
        isEligible: true,
        method: 'Ontario ESA: 1/20th of regular wages + lieu paid out + vacation from prior work weeks'
      };
    }

    const amount = round2((wage * 40) / 5);
    return {
      amount,
      isEligible: true,
      method: 'Estimated average day pay (no prior payroll history)'
    };
  }

  return { amount: 0, isEligible: false, method: 'Unsupported jurisdiction' };
}

/** ESA last/first shift rule using completed time clocks. */
export async function detectMissedShiftsAroundHoliday({
  employeeId,
  businessId,
  holidayDate,
  supabase = defaultSupabase
}) {
  if (!employeeId || !businessId || !holidayDate) {
    return { missedShiftBefore: true, missedShiftAfter: true };
  }

  const tz = await getBusinessTimezoneForPayroll(businessId);
  const holiday = dayjs.tz(`${holidayDate}T12:00:00`, tz);

  const { data: clocks } = await supabase
    .from('scheduling_time_clocks')
    .select('clock_in_time, clock_out_time')
    .eq('employee_id', employeeId)
    .eq('business_id', businessId)
    .not('clock_out_time', 'is', null);

  let workedBefore = false;
  let workedAfter = false;

  (clocks || []).forEach((row) => {
    const d = dayjs(row.clock_in_time).tz(tz);
    if (d.isBefore(holiday, 'day')) workedBefore = true;
    if (d.isAfter(holiday, 'day')) workedAfter = true;
  });

  return {
    missedShiftBefore: !workedBefore,
    missedShiftAfter: !workedAfter
  };
}

export async function computeHolidayPayForEmployeeInPeriod({
  employee,
  businessId,
  periodStart,
  periodEnd,
  jurisdiction = 'ON',
  excludePayrollRunId = null,
  supabase = defaultSupabase
}) {
  const holidays = getCanadianStatHolidaysForPeriod({
    jurisdiction,
    periodStart,
    periodEnd
  });

  if (!holidays.length || !employee?.id) {
    return null;
  }

  // Use the first holiday that actually falls in this pay period (already sorted).
  // Prefer Canada Day only when it is among holidays in this period.
  const holiday =
    holidays.find((h) => h.name === 'Canada Day') || holidays[0];

  const alreadyPaid = await hasHolidayPayAlreadyBeenPaid({
    employeeId: employee.id,
    businessId,
    holidayDate: holiday.date,
    excludePayrollRunId,
    supabase
  });

  if (alreadyPaid) {
    return {
      holidayDate: holiday.date,
      holidayName: holiday.name,
      amount: 0,
      isEligible: false,
      missedShiftBefore: false,
      missedShiftAfter: false,
      method: 'Already paid in a prior payroll period that included this holiday',
      alreadyPaid: true
    };
  }

  const eligibility = await detectMissedShiftsAroundHoliday({
    employeeId: employee.id,
    businessId,
    holidayDate: holiday.date,
    supabase
  });

  const payrollHistory = await fetchHolidayPayrollHistory({
    employeeId: employee.id,
    businessId,
    holidayDate: holiday.date,
    supabase
  });

  const calc = calculateHolidayPayAmount({
    employee,
    jurisdiction,
    payrollHistory,
    missedShiftBefore: eligibility.missedShiftBefore,
    missedShiftAfter: eligibility.missedShiftAfter
  });

  if (!calc.isEligible || calc.amount <= 0) {
    return {
      holidayDate: holiday.date,
      holidayName: holiday.name,
      amount: 0,
      isEligible: false,
      missedShiftBefore: eligibility.missedShiftBefore,
      missedShiftAfter: eligibility.missedShiftAfter,
      method: calc.method
    };
  }

  return {
    holidayDate: holiday.date,
    holidayName: holiday.name,
    amount: calc.amount,
    isEligible: true,
    missedShiftBefore: eligibility.missedShiftBefore,
    missedShiftAfter: eligibility.missedShiftAfter,
    method: calc.method
  };
}
