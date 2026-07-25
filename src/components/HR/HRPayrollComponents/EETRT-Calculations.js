// components/HR/HRPayrollComponents/EETRT-Calculations.js

export const EETRT_detectPaymentFrequency = (entries) => {
  if (!entries || entries.length < 3) {
    return { frequency: null, confidence: 0, analysis: 'Insufficient data' };
  }

  // Filter out synthetic entries for frequency detection
  const realEntries = entries.filter(e => !e.is_synthetic);
  
  if (realEntries.length < 3) {
    return { frequency: 'bi_weekly', confidence: 50, analysis: 'Defaulting to bi-weekly (insufficient real entries)' };
  }

  const sortedEntries = [...realEntries].sort((a, b) => {
    const dateA = new Date(a.hrpayroll_runs?.pay_date || a.pay_date);
    const dateB = new Date(b.hrpayroll_runs?.pay_date || b.pay_date);
    return dateA - dateB;
  });

  const gaps = [];
  for (let i = 1; i < sortedEntries.length; i++) {
    const prevDate = new Date(sortedEntries[i - 1].hrpayroll_runs?.pay_date || sortedEntries[i - 1].pay_date);
    const currDate = new Date(sortedEntries[i].hrpayroll_runs?.pay_date || sortedEntries[i].pay_date);
    const daysDiff = Math.round((currDate - prevDate) / (1000 * 60 * 60 * 24));
    gaps.push(daysDiff);
  }

  if (gaps.length === 0) {
    return { frequency: 'bi_weekly', confidence: 0, analysis: 'No gaps to analyze' };
  }

  const avgGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const gapVariance = gaps.reduce((sum, gap) => sum + Math.pow(gap - avgGap, 2), 0) / gaps.length;
  const gapStdDev = Math.sqrt(gapVariance);

  const classifications = [
    { frequency: 'weekly', expectedGap: 7, tolerance: 2 },
    { frequency: 'bi_weekly', expectedGap: 14, tolerance: 3 },
    { frequency: 'semi_monthly', expectedGap: 15.2, tolerance: 4 },
    { frequency: 'monthly', expectedGap: 30.4, tolerance: 5 }
  ];

  let bestMatch = null;
  let bestScore = 0;

  classifications.forEach(({ frequency, expectedGap, tolerance }) => {
    const gapDeviation = Math.abs(avgGap - expectedGap);
    
    if (gapDeviation <= tolerance) {
      const closenessScore = 1 - (gapDeviation / tolerance);
      const consistencyScore = Math.max(0, 1 - (gapStdDev / expectedGap));
      const score = (closenessScore * 0.7) + (consistencyScore * 0.3);
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          frequency,
          confidence: Math.round(score * 100),
          analysis: `Avg gap: ${avgGap.toFixed(1)} days, Expected: ${expectedGap}, StdDev: ${gapStdDev.toFixed(1)}`
        };
      }
    }
  });

  if (!bestMatch) {
    return {
      frequency: 'bi_weekly',
      confidence: 0,
      analysis: `Irregular pattern - Avg gap: ${avgGap.toFixed(1)} days, StdDev: ${gapStdDev.toFixed(1)}`
    };
  }

  return bestMatch;
};

export const EETRT_calculateROEData = (entries) => {
  if (!entries || entries.length === 0) return null;

  // HARD CODED: Get the last 53 pay periods (ALWAYS 53)
  const last53Periods = entries.slice(0, 53);
  
  // Calculate total hours from entries
  const totalHours = last53Periods.reduce((sum, entry) => {
    return sum + parseFloat(entry.regular_hours || 0) + 
           parseFloat(entry.overtime_hours || 0) + 
           parseFloat(entry.lieu_hours || 0);
  }, 0);

  // Calculate total insurable earnings (should equal total earnings, no cap)
  // NOTE: gross_pay already includes premium pay, so we only add vacation_pay
  const totalInsurableEarnings = last53Periods.reduce((sum, entry) => {
    const grossPay = parseFloat(entry.gross_pay || 0);
    const vacationPay = parseFloat(entry.vacation_pay || 0);
    
    // gross_pay already includes premium pay, so insurable earnings = gross_pay + vacation_pay
    return sum + grossPay + vacationPay;
  }, 0);

  const firstPayPeriod = last53Periods[last53Periods.length - 1];
  const lastPayPeriod = last53Periods[0];

  return {
    totalInsurableEarnings,
    totalHours,
    payPeriods: last53Periods.length,
    firstPayPeriodStart: firstPayPeriod?.hrpayroll_runs?.pay_period_start,
    lastPayPeriodEnd: lastPayPeriod?.hrpayroll_runs?.pay_period_end,
    averageWeeklyEarnings: totalInsurableEarnings / Math.max(last53Periods.length, 1),
    syntheticPeriodsUsed: last53Periods.filter(e => e.is_synthetic).length
  };
};

// CRA T4 box 24/26 cap tables (Maximum Insurable Earnings & YMPE).
// Update annually as new CRA T4127 editions are published.
const T4_BOX_LIMITS = {
  2024: { ei_max_insurable: 63200, cpp_ympe: 68500 },
  2025: { ei_max_insurable: 65700, cpp_ympe: 71300 },
  2026: { ei_max_insurable: 68900, cpp_ympe: 74600 }
};

export const EETRT_calculateT4Data = (entries, taxYear = null) => {
  console.log('[EETRT] calculateT4Data called with:', {
    entryCount: entries.length,
    taxYear,
    sampleEntries: entries.slice(0, 3).map(e => ({
      id: e.id,
      gross_pay: e.gross_pay,
      federal_tax: e.federal_tax,
      provincial_tax: e.provincial_tax,
      cpp_deduction: e.cpp_deduction,
      ei_deduction: e.ei_deduction
    }))
  });

  const totals = entries.reduce((acc, entry) => {
    const grossPay = parseFloat(entry.gross_pay || 0);
    const vacationPay = parseFloat(entry.vacation_pay || 0);
    const federalTax = parseFloat(entry.federal_tax || 0);
    const provincialTax = parseFloat(entry.provincial_tax || 0) + parseFloat(entry.ontario_health_premium || 0);
    const additionalTax = parseFloat(entry.additional_tax || 0);
    const cpp = parseFloat(entry.cpp_deduction || 0);
    const ei = parseFloat(entry.ei_deduction || 0);

    acc.grossIncome += grossPay;
    acc.vacationPay += vacationPay;
    acc.federalTax += federalTax;
    acc.provincialTax += provincialTax;
    acc.additionalTax += additionalTax;
    acc.cppContributions += cpp;
    acc.eiPremiums += ei;
    
    try {
      const premiums = typeof entry.premiums === 'string' ?
        JSON.parse(entry.premiums) : (entry.premiums || {});
      Object.values(premiums).forEach(premium => {
        if (premium.total_pay) {
          acc.premiumPay += parseFloat(premium.total_pay);
        }
      });
    } catch (e) {
      // Premium parsing failed, continue
    }

    return acc;
  }, {
    grossIncome: 0, vacationPay: 0, premiumPay: 0,
    federalTax: 0, provincialTax: 0, additionalTax: 0, cppContributions: 0, eiPremiums: 0
  });

  const employmentIncome = totals.grossIncome + totals.vacationPay + totals.premiumPay;
  const totalTax = totals.federalTax + totals.provincialTax + totals.additionalTax;

  // Resolve T4 box 24/26 caps for the requested tax year (defaults to current calendar year)
  const resolvedYear = taxYear || new Date().getFullYear();
  const limits = T4_BOX_LIMITS[resolvedYear] || T4_BOX_LIMITS[2026];

  const result = {
    box14_employmentIncome: employmentIncome,
    box16_cppContributions: totals.cppContributions,
    box18_eiPremiums: totals.eiPremiums,
    box22_incomeTax: totalTax,
    box24_eiInsurableEarnings: Math.min(employmentIncome, limits.ei_max_insurable),
    box26_cppPensionableEarnings: Math.min(employmentIncome, limits.cpp_ympe),
    box_limits_used: { tax_year: resolvedYear, ...limits },
    breakdown: {
      grossIncome: totals.grossIncome,
      vacationPay: totals.vacationPay,
      premiumPay: totals.premiumPay,
      federalTax: totals.federalTax,
      provincialTax: totals.provincialTax
    }
  };

  console.log('[EETRT] calculateT4Data result:', {
    totals: totals,
    result: result
  });

  return result;
};

export const EETRT_processPayrollForROE = (entries) => {
  console.log('[EETRT] Processing payroll for ROE breakdown:', {
    totalEntries: entries.length,
    sample: entries.slice(0, 5).map(e => ({
      id: e.id,
      pay_date: e.hrpayroll_runs?.pay_date || e.pay_date,
      gross_pay: e.gross_pay,
      is_migration: e.is_migration_entry || false,
      is_synthetic: e.is_synthetic || false
    })),
    breakdown: {
      regular: entries.filter(e => !e.is_migration_entry && !e.is_synthetic).length,
      migration: entries.filter(e => e.is_migration_entry).length,
      synthetic: entries.filter(e => e.is_synthetic).length
    }
  });

  const weeklyData = {};

  entries.forEach(entry => {
    const payDate = new Date(entry.hrpayroll_runs?.pay_date || entry.pay_date);
    const weekStart = new Date(entry.hrpayroll_runs?.pay_period_start || entry.period_start_date || entry.pay_date);
    const weekEnd = new Date(entry.hrpayroll_runs?.pay_period_end || entry.period_end_date || entry.pay_date);
    
    const year = payDate.getFullYear();
    const weekNumber = getISOWeek(payDate);
    const weekKey = `${year}-W${weekNumber.toString().padStart(2, '0')}`;

    const grossPay = parseFloat(entry.gross_pay || 0);
    const vacationPay = parseFloat(entry.vacation_pay || 0);
    
    let premiumPay = 0;
    try {
      const premiums = typeof entry.premiums === 'string' ? 
        JSON.parse(entry.premiums) : (entry.premiums || {});
      
      Object.values(premiums).forEach(premium => {
        if (premium.total_pay) {
          premiumPay += parseFloat(premium.total_pay);
        }
      });
    } catch (e) {
      // Premium parsing failed
    }

    // gross_pay already includes premium pay, so total earnings = gross_pay + vacation_pay
    const totalEarnings = grossPay + vacationPay;
    // Insurable earnings should equal total earnings (no cap applied)
    const insurableEarnings = totalEarnings;

    const regularHours = parseFloat(entry.regular_hours || 0);
    const overtimeHours = parseFloat(entry.overtime_hours || 0);
    const lieuHours = parseFloat(entry.lieu_hours || 0);
    const totalHours = regularHours + overtimeHours + lieuHours;

    if (!weeklyData[weekKey]) {
      weeklyData[weekKey] = {
        weekKey,
        weekStart: weekStart.toISOString().split('T')[0],
        weekEnd: weekEnd.toISOString().split('T')[0],
        payDate: payDate.toISOString().split('T')[0],
        hours: 0, regularHours: 0, overtimeHours: 0, lieuHours: 0,
        grossEarnings: 0, insurableEarnings: 0, vacationPay: 0, premiumPay: 0,
        entries: [],
        isSynthetic: entry.is_synthetic || false
      };
    }

    weeklyData[weekKey].hours += totalHours;
    weeklyData[weekKey].regularHours += regularHours;
    weeklyData[weekKey].overtimeHours += overtimeHours;
    weeklyData[weekKey].lieuHours += lieuHours;
    // grossEarnings should be gross_pay + vacation_pay (premium is already in gross_pay)
    weeklyData[weekKey].grossEarnings += totalEarnings;
    weeklyData[weekKey].insurableEarnings += insurableEarnings;
    weeklyData[weekKey].vacationPay += vacationPay;
    // premiumPay is extracted for display, but not added to totals (already in gross_pay)
    weeklyData[weekKey].premiumPay += premiumPay;
    weeklyData[weekKey].entries.push(entry);
  });

  const sortedWeeks = Object.values(weeklyData).sort((a, b) => 
    new Date(b.payDate) - new Date(a.payDate)
  );

  console.log('[EETRT] ROE weekly breakdown created:', {
    totalWeeks: sortedWeeks.length,
    sample: sortedWeeks.slice(0, 5).map(w => ({
      weekKey: w.weekKey,
      payDate: w.payDate,
      grossEarnings: w.grossEarnings,
      insurableEarnings: w.insurableEarnings,
      entriesCount: w.entries.length,
      entryTypes: {
        regular: w.entries.filter(e => !e.is_migration_entry && !e.is_synthetic).length,
        migration: w.entries.filter(e => e.is_migration_entry).length,
        synthetic: w.entries.filter(e => e.is_synthetic).length
      }
    }))
  });

  return sortedWeeks;
};

const getISOWeek = (date) => {
  const target = new Date(date.valueOf());
  const dayNumber = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNumber + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target) / 604800000);
};