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

  const sortedEntries = [...realEntries].sort((a, b) => 
    new Date(a.hrpayroll_runs.pay_date) - new Date(b.hrpayroll_runs.pay_date)
  );

  const gaps = [];
  for (let i = 1; i < sortedEntries.length; i++) {
    const prevDate = new Date(sortedEntries[i - 1].hrpayroll_runs.pay_date);
    const currDate = new Date(sortedEntries[i].hrpayroll_runs.pay_date);
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
  
  const totalInsurableEarnings = last53Periods.reduce((sum, entry) => {
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
      premiumPay = 0;
    }

    const totalEarnings = grossPay + vacationPay + premiumPay;
    const maxWeeklyInsurable = 1263; // 2025 EI maximum
    return sum + Math.min(totalEarnings, maxWeeklyInsurable);
  }, 0);

  const totalHours = last53Periods.reduce((sum, entry) => {
    return sum + parseFloat(entry.regular_hours || 0) + 
           parseFloat(entry.overtime_hours || 0) + 
           parseFloat(entry.lieu_hours || 0);
  }, 0);

  const firstPayPeriod = last53Periods[last53Periods.length - 1];
  const lastPayPeriod = last53Periods[0];

  return {
    totalInsurableEarnings,
    totalHours,
    payPeriods: last53Periods.length,
    firstPayPeriodStart: firstPayPeriod?.hrpayroll_runs.pay_period_start,
    lastPayPeriodEnd: lastPayPeriod?.hrpayroll_runs.pay_period_end,
    averageWeeklyEarnings: totalInsurableEarnings / Math.max(last53Periods.length, 1),
    syntheticPeriodsUsed: last53Periods.filter(e => e.is_synthetic).length
  };
};

export const EETRT_calculateT4Data = (entries) => {
  const totals = entries.reduce((acc, entry) => {
    acc.grossIncome += parseFloat(entry.gross_pay || 0);
    acc.vacationPay += parseFloat(entry.vacation_pay || 0);
    acc.federalTax += parseFloat(entry.federal_tax || 0);
    acc.provincialTax += parseFloat(entry.provincial_tax || 0);
    acc.cppContributions += parseFloat(entry.cpp_deduction || 0);
    acc.eiPremiums += parseFloat(entry.ei_deduction || 0);
    
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
    federalTax: 0, provincialTax: 0, cppContributions: 0, eiPremiums: 0
  });

  const employmentIncome = totals.grossIncome + totals.vacationPay + totals.premiumPay;
  const totalTax = totals.federalTax + totals.provincialTax;
  
  return {
    box14_employmentIncome: employmentIncome,
    box16_cppContributions: totals.cppContributions,
    box18_eiPremiums: totals.eiPremiums,
    box22_incomeTax: totalTax,
    box24_eiInsurableEarnings: Math.min(employmentIncome, 68500),
    box26_cppPensionableEarnings: Math.min(employmentIncome, 71300),
    breakdown: {
      grossIncome: totals.grossIncome,
      vacationPay: totals.vacationPay,
      premiumPay: totals.premiumPay,
      federalTax: totals.federalTax,
      provincialTax: totals.provincialTax
    }
  };
};

export const EETRT_processPayrollForROE = (entries) => {
  const weeklyData = {};

  entries.forEach(entry => {
    const payDate = new Date(entry.hrpayroll_runs.pay_date);
    const weekStart = new Date(entry.hrpayroll_runs.pay_period_start);
    const weekEnd = new Date(entry.hrpayroll_runs.pay_period_end);
    
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

    const totalEarnings = grossPay + vacationPay + premiumPay;
    const maxWeeklyInsurable = 1263; // 2025 EI maximum
    const insurableEarnings = Math.min(totalEarnings, maxWeeklyInsurable);

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
    weeklyData[weekKey].grossEarnings += totalEarnings;
    weeklyData[weekKey].insurableEarnings += insurableEarnings;
    weeklyData[weekKey].vacationPay += vacationPay;
    weeklyData[weekKey].premiumPay += premiumPay;
    weeklyData[weekKey].entries.push(entry);
  });

  return Object.values(weeklyData).sort((a, b) => 
    new Date(b.payDate) - new Date(a.payDate)
  );
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