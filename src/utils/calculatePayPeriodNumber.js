/**
 * Calculate the pay period number for a given date within a tax year
 * Uses the CRA Option 2 cumulative averaging method
 * 
 * @param {Date|string} periodEndDate - End date of the pay period
 * @param {string} payFrequency - 'weekly', 'bi_weekly', 'semi_monthly', 'monthly'
 * @param {Date|string} yearStartDate - Start date of the tax year (defaults to Jan 1 of periodEndDate year)
 * @returns {number} Pay period number (1, 2, 3, etc.)
 */
export const calculatePayPeriodNumber = (periodEndDate, payFrequency, yearStartDate = null) => {
  // Convert to Date objects if strings
  const periodEnd = periodEndDate instanceof Date ? periodEndDate : new Date(periodEndDate);
  const yearStart = yearStartDate 
    ? (yearStartDate instanceof Date ? yearStartDate : new Date(yearStartDate))
    : new Date(periodEnd.getFullYear(), 0, 1); // January 1st of the tax year

  // Calculate days between year start and period end
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysDiff = Math.floor((periodEnd - yearStart) / msPerDay);

  // CRITICAL FIX: Period number calculation
  // We must ensure we're only counting periods that END in the current tax year
  // If the period end date is before the tax year start, it belongs to the previous year
  // and should NOT be counted (return 1 as the first period of the current year)
  if (daysDiff < 0) {
    // Period end is before year start - this period belongs to the previous tax year
    // Return 1 to indicate this is the first period we're calculating for the current year
    console.warn('[calculatePayPeriodNumber] Period end date is before tax year start:', {
      periodEndDate: periodEnd.toISOString().split('T')[0],
      yearStartDate: yearStart.toISOString().split('T')[0],
      daysDiff,
      warning: 'This period belongs to the previous tax year and should not be included in current year calculations'
    });
    return 1; // First period of current tax year
  }
  
  // If daysDiff is 0, the period ends exactly on Jan 1 - this is period 1
  if (daysDiff === 0) {
    return 1;
  }

  // Calculate period number based on frequency
  let periodNumber = 1;
  switch (payFrequency) {
    case 'weekly':
      // For weekly: day 0-6 = period 1, day 7-13 = period 2, etc.
      periodNumber = Math.max(1, Math.floor(daysDiff / 7) + 1);
      break;
    case 'bi_weekly':
    case 'bi_weekly':
      periodNumber = Math.max(1, Math.floor(daysDiff / 14) + 1);
      break;
    case 'semi_monthly':
      // Approximately 15 days per period, but can vary
      periodNumber = Math.max(1, Math.floor(daysDiff / 15) + 1);
      break;
    case 'monthly':
      periodNumber = Math.max(1, Math.floor(daysDiff / 30) + 1);
      break;
    default:
      // Default to bi-weekly
      periodNumber = Math.max(1, Math.floor(daysDiff / 14) + 1);
  }

  // Cap at maximum periods per year
  const maxPeriods = {
    'weekly': 53,
    'bi_weekly': 27,
    'semi_monthly': 24,
    'monthly': 12
  };
  const max = maxPeriods[payFrequency] || 27;
  
  return Math.min(periodNumber, max);
};

/**
 * Calculate S1 factor for CRA Option 2 cumulative averaging
 * S1 = payPeriods / currentPeriodNumber
 * 
 * @param {number} payPeriods - Total periods per year (52, 26, etc.)
 * @param {number} currentPeriodNumber - Current pay period number (1, 2, 3, etc.)
 * @returns {number} S1 annualizing factor
 */
export const calculateS1Factor = (payPeriods, currentPeriodNumber) => {
  if (!currentPeriodNumber || currentPeriodNumber < 1) {
    return payPeriods; // Default to first period if not specified
  }
  return payPeriods / currentPeriodNumber;
};

/**
 * Calculate pay frequency and periods per year from period start and end dates
 * 
 * @param {Date|string} periodStartDate - Start date of the pay period
 * @param {Date|string} periodEndDate - End date of the pay period
 * @returns {Object} { frequency: string, periodsPerYear: number }
 */
export const calculatePayFrequencyFromDates = (periodStartDate, periodEndDate) => {
  if (!periodStartDate || !periodEndDate) {
    return { frequency: null, periodsPerYear: null };
  }

  const start = periodStartDate instanceof Date ? periodStartDate : new Date(periodStartDate);
  const end = periodEndDate instanceof Date ? periodEndDate : new Date(periodEndDate);
  
  // Calculate days in the period (inclusive)
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysDiff = Math.ceil((end - start) / msPerDay) + 1; // +1 to include both start and end days

  // Determine frequency based on period length
  // Allow some tolerance for weekends/holidays affecting actual pay dates
  let frequency;
  let periodsPerYear;

  if (daysDiff <= 8) {
    // Weekly: 7 days (allow 8 for weekend overlap)
    frequency = 'weekly';
    periodsPerYear = 52;
  } else if (daysDiff <= 15) {
    // Bi-weekly: 14 days (allow up to 15)
    frequency = 'bi_weekly';
    periodsPerYear = 26;
  } else if (daysDiff <= 17) {
    // Semi-monthly: ~15 days (allow 15-17)
    frequency = 'semi_monthly';
    periodsPerYear = 24;
  } else {
    // Monthly: ~30 days
    frequency = 'monthly';
    periodsPerYear = 12;
  }

  return { frequency, periodsPerYear };
};

