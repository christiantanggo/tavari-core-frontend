/**
 * Shared utility function to normalize YTD data from useYTDCalculations hook
 * This ensures ALL pay statement views (PDF, email PDF, web view) use the EXACT same YTD values
 *
 * @param {Object} ytdData - Raw YTD data from ytd.calculateEmployeeYTD()
 * @returns {Object} Normalized YTD totals in consistent format
 */
export const normalizeYTDTotals = (ytdData) => {
  if (!ytdData) {
    return {
      regular_hours: 0,
      overtime_hours: 0,
      lieu_hours: 0,
      stat_hours: 0,
      holiday_hours: 0,
      regular_earnings: 0,
      overtime_earnings: 0,
      lieu_earnings: 0,
      stat_earnings: 0,
      holiday_earnings: 0,
      shift_premiums: 0,
      vacation_pay: 0,
      bonus: 0,
      gross_pay: 0,
      federal_tax: 0,
      provincial_tax: 0,
      ei_deduction: 0,
      cpp_deduction: 0,
      additional_tax: 0,
      net_pay: 0,
      _ytd_source: 'empty_fallback'
    };
  }

  // Normalize to consistent format - use exact same field mappings
  return {
    regular_hours: ytdData.regular_hours || 0,
    overtime_hours: ytdData.overtime_hours || 0,
    lieu_hours: ytdData.lieu_hours || 0,
    stat_hours: ytdData.stat_hours || 0,
    holiday_hours: ytdData.holiday_hours || 0,
    regular_earnings: ytdData.regular_income || 0,
    overtime_earnings: ytdData.overtime_income || 0,
    lieu_earnings: ytdData.lieu_income || 0,
    stat_earnings: ytdData.stat_earnings || 0,
    holiday_earnings: ytdData.holiday_earnings || 0,
    shift_premiums: ytdData.shift_premiums || 0,
    vacation_pay: ytdData.vacation_pay || 0,
    bonus: ytdData.bonus || 0,
    gross_pay: ytdData.gross_pay || 0,
    federal_tax: ytdData.federal_tax || 0,
    provincial_tax: ytdData.provincial_tax || 0,
    ei_deduction: ytdData.ei_deduction || 0,
    cpp_deduction: ytdData.cpp_deduction || 0,
    additional_tax: ytdData.additional_tax || 0,
    net_pay: ytdData.net_pay || 0,
    _ytd_source: ytdData._ytd_source || 'fast_ytd_lookup',
    _ytd_last_updated: ytdData.last_updated,
    _ytd_calculation_date: ytdData.calculation_date,
    _ytd_entries_included: ytdData.entries_included
  };
};

/**
 * Add the current pay statement entry on top of YTD that already excludes this payroll run.
 * Use with calculateEmployeeYTD(..., { excludePayrollRunId }) so each dollar is counted once.
 *
 * @param {Object} ytdTotals - Normalized YTD object (same shape as normalizeYTDTotals output)
 * @param {Object} entry - hrpayroll_entries row with users relation
 * @returns {Object} Display YTD for the statement
 */
export const addCurrentPeriodToPayStatementYtd = (ytdTotals, entry) => {
  if (!entry) {
    return ytdTotals || normalizeYTDTotals(null);
  }
  const base = ytdTotals || normalizeYTDTotals(null);

  let premiums = {};
  let currentPremiumPay = 0;
  try {
    premiums = typeof entry.premiums === 'string'
      ? JSON.parse(entry.premiums)
      : (entry.premiums || {});
    Object.values(premiums).forEach((premium) => {
      if (premium.total_pay) {
        currentPremiumPay += parseFloat(premium.total_pay);
      }
    });
  } catch (e) {
    premiums = {};
  }

  let wageBreakdown = [];
  let hasWageChange = false;
  try {
    if (entry.wage_breakdown) {
      wageBreakdown = typeof entry.wage_breakdown === 'string'
        ? JSON.parse(entry.wage_breakdown)
        : entry.wage_breakdown;
      hasWageChange = Array.isArray(wageBreakdown) && wageBreakdown.length > 1;
    }
  } catch (e) {
    wageBreakdown = [];
  }

  const currentGrossPay = parseFloat(entry.gross_pay || 0);
  const currentVacationPay = parseFloat(entry.vacation_pay || 0);
  const currentFederalTax = parseFloat(entry.federal_tax || 0);
  const currentProvincialTax = parseFloat(entry.provincial_tax || 0);
  const currentEIDeduction = parseFloat(entry.ei_deduction || 0);
  const currentCPPDeduction = parseFloat(entry.cpp_deduction || 0);
  const currentAdditionalTax = parseFloat(entry.additional_tax || 0);

  const regularHours = parseFloat(entry.regular_hours || 0);
  const overtimeHours = parseFloat(entry.overtime_hours || 0);
  const lieuHours = parseFloat(entry.lieu_hours || 0);
  const statHolidayHours = parseFloat(entry.stat_holiday_hours || 0);

  const baseWage = parseFloat(entry.users?.wage || 0);

  let regularEarnings = 0;
  let overtimeEarnings = 0;
  let lieuEarnings = 0;

  if (hasWageChange && wageBreakdown.length > 0) {
    wageBreakdown.forEach((period) => {
      if (!period.is_lieu_payment) {
        regularEarnings += parseFloat(period.regular_pay || 0);
        overtimeEarnings += parseFloat(period.overtime_pay || 0);
      } else {
        lieuEarnings += parseFloat(period.lieu_pay || 0);
      }
    });
  } else {
    regularEarnings = regularHours * baseWage;
    overtimeEarnings = overtimeHours * baseWage * 1.5;
    lieuEarnings = lieuHours * baseWage;
  }

  const statEarnings = statHolidayHours * baseWage * 1.5;
  const holidayEarnings = parseFloat(entry.holiday_pay || 0);

  return {
    ...base,
    regular_hours: (parseFloat(base.regular_hours) || 0) + regularHours,
    overtime_hours: (parseFloat(base.overtime_hours) || 0) + overtimeHours,
    lieu_hours: (parseFloat(base.lieu_hours) || 0) + lieuHours,
    stat_hours: (parseFloat(base.stat_hours) || 0) + statHolidayHours,
    holiday_hours: (parseFloat(base.holiday_hours) || 0) + (holidayEarnings > 0 ? 1 : 0),
    regular_earnings: (parseFloat(base.regular_earnings) || 0) + regularEarnings,
    overtime_earnings: (parseFloat(base.overtime_earnings) || 0) + overtimeEarnings,
    lieu_earnings: (parseFloat(base.lieu_earnings) || 0) + lieuEarnings,
    stat_earnings: (parseFloat(base.stat_earnings) || 0) + statEarnings,
    holiday_earnings: (parseFloat(base.holiday_earnings) || 0) + holidayEarnings,
    shift_premiums: (parseFloat(base.shift_premiums) || 0) + currentPremiumPay,
    vacation_pay: (parseFloat(base.vacation_pay) || 0) + currentVacationPay,
    gross_pay: (parseFloat(base.gross_pay) || 0) + currentGrossPay,
    federal_tax: (parseFloat(base.federal_tax) || 0) + currentFederalTax,
    provincial_tax: (parseFloat(base.provincial_tax) || 0) + currentProvincialTax,
    ei_deduction: (parseFloat(base.ei_deduction) || 0) + currentEIDeduction,
    cpp_deduction: (parseFloat(base.cpp_deduction) || 0) + currentCPPDeduction,
    additional_tax: (parseFloat(base.additional_tax) || 0) + currentAdditionalTax,
    net_pay: (parseFloat(base.net_pay) || 0) + parseFloat(entry.net_pay || 0)
  };
};
