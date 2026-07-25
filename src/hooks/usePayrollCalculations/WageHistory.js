// hooks/usePayrollCalculations-Part2-Calculate.js
// Main calculation logic for employee pay

import { resolveAvailableLieuBalance } from '../../helpers/Payroll/lieuTimeLedger';

export const calculateEmployeePayLogic = async ({
  employee,
  hours,
  yearToDate = {},
  additionalFedTaxAmount = 0,
  payPeriod = null,
  settings,
  wageHistory,
  canadianTax,
  recordAction
}) => {
  const defaultResult = {
    employee_id: employee?.id || null,
    regular_hours: 0,
    overtime_hours: 0,
    lieu_hours: 0,
    regular_pay: 0,
    overtime_pay: 0,
    lieu_pay: 0,
    premium_pay: 0,
    premium_breakdown: {},
    gross_pay: 0,
    vacation_pay: 0,
    gross_pay_with_vacation: 0,
    federal_tax: 0,
    additional_federal_tax: 0,
    total_federal_tax: 0,
    provincial_tax: 0,
    cpp_contribution: 0,
    ei_premium: 0,
    total_deductions: 0,
    net_pay: 0,
    regular_hours_worked: 0,
    regular_hours_paid: 0,
    lieu_earned: 0,
    lieu_used: 0,
    lieu_balance_before: 0,
    lieu_balance_after: 0,
    stat_holiday_hours: 0,
    year_to_date: {
      gross: 0,
      cpp: 0,
      ei: 0,
      federal_tax: 0,
      provincial_tax: 0
    },
    wage_breakdown: [],
    lieu_calculation: null,
    has_wage_changes: false,
    calculation_method: 'error_fallback'
  };

  if (!employee || !hours || !settings) {
    return defaultResult;
  }

  try {
    const {
      total_hours = 0,
      regular_hours = 0,
      overtime_hours = 0,
      stat_worked_hours = 0,
      premiums = {},
      wage_period_hours = []
    } = hours;

    const {
      yearToDateGross = 0,
      yearToDateEI = 0,
      yearToDateCPP = 0,
      yearToDateFederalTax = 0,
      yearToDateProvincialTax = 0
    } = yearToDate;

    // Helper: Calculate vacation percent based on years of service
    const calculateVacationPercent = (employee, defaultVacationPercent = 0.04) => {
      // If vacation_percent is explicitly set (not null/undefined), use it (might be an override)
      if (employee.vacation_percent != null) {
        let percent = parseFloat(employee.vacation_percent);
        // If it looks like a percentage (>= 1.0), convert to decimal
        if (percent >= 1.0) {
          percent = percent / 100;
        }
        return percent;
      }
      
      // If not set, calculate based on years of service (ESA requirement)
      if (employee.hire_date) {
        const hireDate = new Date(employee.hire_date);
        const currentDate = new Date();
        const yearsOfService = (currentDate - hireDate) / (365.25 * 24 * 60 * 60 * 1000);
        
        // ESA minimum: 4% for <5 years, 6% for 5+ years
        if (yearsOfService >= 5) {
          return 0.06;
        }
      }
      
      // Fall back to default (usually 4%)
      // Normalize defaultVacationPercent - if it's stored as percentage (>= 1.0), convert to decimal
      let defaultPercent = parseFloat(defaultVacationPercent || 0.04);
      if (defaultPercent >= 1.0) {
        defaultPercent = defaultPercent / 100;
      }
      return defaultPercent;
    };

    const baseWage = parseFloat(employee.wage || 0);
    const vacationPercent = calculateVacationPercent(employee, settings.default_vacation_percent);
    const overtimeMultiplier = parseFloat(settings.overtime_multiplier || 1.5);
    const claimCode = parseInt(employee.claim_code || settings.default_claim_code || 1);
    const additionalFedTax = parseFloat(additionalFedTaxAmount || 0);
    const jurisdiction = settings.tax_jurisdiction || 'ON';

    if (baseWage <= 0) {
      return defaultResult;
    }

    // ============================================================
    // CALCULATE TOTAL HOURS (from wage periods if wage change)
    // ============================================================
    let actualTotalHours = total_hours;
    let actualOvertimeHours = overtime_hours;
    let actualRegularHours = regular_hours;

    if (wage_period_hours && Array.isArray(wage_period_hours) && wage_period_hours.length > 0) {
      actualRegularHours = wage_period_hours.reduce((sum, period) => 
        sum + (parseFloat(period.regular_hours) || 0), 0
      );
      actualOvertimeHours = wage_period_hours.reduce((sum, period) => 
        sum + (parseFloat(period.overtime_hours) || 0), 0
      );
      actualTotalHours = actualRegularHours + actualOvertimeHours;
    } else if (total_hours > 0) {
      actualRegularHours = total_hours - overtime_hours;
      actualOvertimeHours = overtime_hours;
    }

    // ============================================================
    // LIEU TIME CALCULATION (INDEPENDENT OF WAGE)
    // ============================================================
    let lieuEarned = 0;
    let lieuUsed = 0;
    let regularHoursPaid = actualRegularHours;
    const lieuBalanceBefore = resolveAvailableLieuBalance(employee);
    let lieuBalanceAfter = lieuBalanceBefore;
    
    const lieuCalculation = {
      enabled: employee.lieu_time_enabled || false,
      maxHours: parseFloat(employee.max_paid_hours_per_period || 0),
      totalWorkedHours: actualTotalHours,
      statHours: parseFloat(stat_worked_hours || 0),
      lieuEarned: 0,
      lieuUsed: 0,
      lieuBalanceBefore: lieuBalanceBefore,
      lieuBalanceAfter: lieuBalanceBefore
    };

    if (employee?.lieu_time_enabled) {
      const maxHours = parseFloat(employee.max_paid_hours_per_period || 0);
      const currentBalance = resolveAvailableLieuBalance(employee);
      const totalCompensationHours = actualTotalHours + parseFloat(stat_worked_hours || 0);
      
      if (maxHours > 0) {
        if (totalCompensationHours > maxHours) {
          // EARNING lieu time
          lieuEarned = totalCompensationHours - maxHours;
          regularHoursPaid = Math.max(0, maxHours - parseFloat(stat_worked_hours || 0) - actualOvertimeHours);
          lieuBalanceAfter = currentBalance + lieuEarned;
        } else if (currentBalance > 0) {
          // USING lieu time - only when balance is available
          const shortfall = maxHours - totalCompensationHours;
          lieuUsed = Math.min(shortfall, currentBalance);
          regularHoursPaid = actualRegularHours;
          lieuBalanceAfter = currentBalance - lieuUsed;
        }
      }

      lieuCalculation.lieuEarned = lieuEarned;
      lieuCalculation.lieuUsed = lieuUsed;
      lieuCalculation.lieuBalanceAfter = lieuBalanceAfter;
    }

    // ============================================================
    // CHECK FOR WAGE CHANGES DURING PAY PERIOD
    // ============================================================
    let wagePeriods = [];
    let hasWageChanges = false;
    
    if (payPeriod && payPeriod.start && payPeriod.end && wageHistory) {
      try {
        wagePeriods = await wageHistory.getWagePeriodsInRange(
          employee.id,
          payPeriod.start,
          payPeriod.end
        );
        
        hasWageChanges = wagePeriods.length > 1;
        
        if (hasWageChanges) {
          console.log(`💰 WAGE CHANGE DETECTED for ${employee.first_name} ${employee.last_name}:`, {
            periods: wagePeriods.length,
            details: wagePeriods.map(p => `${p.startDate} to ${p.endDate}: $${p.wage.toFixed(2)}/hr`)
          });
        }
      } catch (wageError) {
        console.error('Error getting wage periods, using current wage:', wageError);
        wagePeriods = [];
        hasWageChanges = false;
      }
    }

    // ============================================================
    // CALCULATE PAY COMPONENTS (WITH OR WITHOUT WAGE SPLITS)
    // ============================================================
    let regularPay = 0;
    let overtimePay = 0;
    let lieuPay = 0;
    let wageBreakdown = [];

    if (hasWageChanges && wagePeriods.length > 0) {
      // ✅ WAGE CHANGED MID-PERIOD
      // Split regular/overtime hours proportionally, but NOT lieu hours
      const regularSplits = wageHistory.splitHoursAcrossPeriods(regularHoursPaid, wagePeriods);
      const overtimeSplits = wageHistory.splitHoursAcrossPeriods(actualOvertimeHours, wagePeriods);
      
      // ✅ LIEU TIME: Pay at HIGHEST wage rate
      const highestWage = Math.max(...wagePeriods.map(p => p.wage));
      lieuPay = lieuUsed * highestWage;

      regularSplits.forEach((split, index) => {
        const regAmount = split.hours * split.wage;
        const otAmount = overtimeSplits[index].hours * split.wage * overtimeMultiplier;

        regularPay += regAmount;
        overtimePay += otAmount;

        wageBreakdown.push({
          period: `${split.startDate} to ${split.endDate}`,
          wage: split.wage,
          days_in_period: split.daysInPeriod,
          regular_hours: split.hours,
          regular_pay: regAmount,
          overtime_hours: overtimeSplits[index].hours,
          overtime_pay: otAmount,
          lieu_hours: 0,
          lieu_pay: 0,
          subtotal: regAmount + otAmount,
          is_lieu_payment: false
        });
      });
      
      // ✅ Add separate entry for lieu time at highest wage
      if (lieuUsed > 0) {
        wageBreakdown.push({
          period: `Lieu Time (paid @ $${highestWage.toFixed(2)}/hr)`,
          wage: highestWage,
          days_in_period: 0,
          regular_hours: 0,
          regular_pay: 0,
          overtime_hours: 0,
          overtime_pay: 0,
          lieu_hours: lieuUsed,
          lieu_pay: lieuPay,
          subtotal: lieuPay,
          is_lieu_payment: true
        });
      }

      console.log(`   📋 Pay breakdown with lieu @ $${highestWage.toFixed(2)}/hr:`, wageBreakdown);
    } else {
      // NO WAGE CHANGE - Single calculation
      const wage = wagePeriods.length > 0 ? wagePeriods[0].wage : baseWage;
      
      regularPay = regularHoursPaid * wage;
      overtimePay = actualOvertimeHours * wage * overtimeMultiplier;
      lieuPay = lieuUsed * wage;

      wageBreakdown.push({
        period: payPeriod ? `${payPeriod.start} to ${payPeriod.end}` : 'Full period',
        wage: wage,
        days_in_period: wagePeriods[0]?.daysInPeriod || 14,
        regular_hours: regularHoursPaid,
        regular_pay: regularPay,
        overtime_hours: actualOvertimeHours,
        overtime_pay: overtimePay,
        lieu_hours: lieuUsed,
        lieu_pay: lieuPay,
        subtotal: regularPay + overtimePay + lieuPay,
        is_lieu_payment: false
      });
    }

    // ============================================================
    // CALCULATE PREMIUMS
    // ============================================================
    let totalPremiumPay = 0;
    const premiumBreakdown = {};
    
    if (premiums && typeof premiums === 'object') {
      Object.entries(premiums).forEach(([premiumId, premiumData]) => {
        if (premiumData && premiumData.enabled && premiumData.hours > 0) {
          const rate = parseFloat(premiumData.rate || 0);
          const premiumHours = parseFloat(premiumData.hours || 0);
          const premiumAmount = premiumHours * rate;
          totalPremiumPay += premiumAmount;
          
          premiumBreakdown[premiumId] = {
            name: premiumData.name || `Premium ${premiumId}`,
            hours: premiumHours,
            rate: rate,
            amount: premiumAmount
          };
        }
      });
    }

    // ============================================================
    // CALCULATE TOTALS AND TAXES
    // ============================================================
    const grossPay = regularPay + overtimePay + lieuPay + totalPremiumPay;
    const vacationPay = settings.auto_calculate_vacation ? (grossPay * vacationPercent) : 0;
    const grossPayWithVacation = grossPay + vacationPay;

    const payFrequency = settings.pay_frequency || 'weekly';
    const payPeriods = payFrequency === 'weekly' ? 52 : 
                      payFrequency === 'bi-weekly' ? 26 : 
                      payFrequency === 'monthly' ? 12 : 26;

    let taxDeductions = {};
    try {
      if (canadianTax && canadianTax.calculateTaxDeductions) {
        taxDeductions = await canadianTax.calculateTaxDeductions(
          grossPayWithVacation,
          claimCode,
          jurisdiction,
          payPeriods,
          {
            yearToDateGross,
            yearToDateEI,
            yearToDateCPP
          }
        );
      }
    } catch (taxError) {
      console.error('Tax calculation error:', taxError);
      taxDeductions = {
        federal_tax: Math.max(0, (grossPayWithVacation - 310) * 0.15),
        provincial_tax: Math.max(0, (grossPayWithVacation - 245) * 0.0505),
        ei_premium: Math.min(grossPayWithVacation * 0.0164, 20.72),
        cpp_contribution: Math.max(0, Math.min((grossPayWithVacation - 67.31) * 0.0595, 74.36)),
        calculation_method: 'fallback_simplified'
      };
    }

    const baseFederalTax = parseFloat(taxDeductions.federal_tax || 0);
    const totalFederalTax = baseFederalTax + additionalFedTax;
    const baseProvincialTax = parseFloat(taxDeductions.provincial_tax || 0);
    const ontarioHealthPremium = parseFloat(taxDeductions.ontario_health_premium || 0);
    const totalDeductions = totalFederalTax + baseProvincialTax + ontarioHealthPremium + 
                           (taxDeductions.ei_premium || 0) + (taxDeductions.cpp_contribution || 0);
    const netPay = Math.max(0, grossPayWithVacation - totalDeductions);

    const newYearToDateGross = yearToDateGross + grossPayWithVacation;
    const newYearToDateFederalTax = yearToDateFederalTax + totalFederalTax;
    const newYearToDateProvincialTax = yearToDateProvincialTax + baseProvincialTax;
    const newYearToDateCPP = yearToDateCPP + (taxDeductions.cpp_contribution || 0);
    const newYearToDateEI = yearToDateEI + (taxDeductions.ei_premium || 0);

    try {
      if (recordAction && typeof recordAction === 'function') {
        await recordAction('calculate_employee_pay', true);
      }
    } catch (actionError) {
      console.warn('Failed to record action:', actionError);
    }

    return {
      employee_id: employee.id,
      regular_hours: actualRegularHours,
      regular_hours_worked: actualRegularHours,
      regular_hours_paid: regularHoursPaid,
      overtime_hours: actualOvertimeHours,
      lieu_hours: lieuUsed,
      lieu_earned: lieuEarned,
      lieu_used: lieuUsed,
      lieu_balance_before: lieuBalanceBefore,
      lieu_balance_after: lieuBalanceAfter,
      stat_holiday_hours: parseFloat(stat_worked_hours || 0),
      regular_pay: regularPay,
      overtime_pay: overtimePay,
      lieu_pay: lieuPay,
      premium_pay: totalPremiumPay,
      premium_breakdown: premiumBreakdown,
      gross_pay: grossPay,
      vacation_pay: vacationPay,
      gross_pay_with_vacation: grossPayWithVacation,
      federal_tax: baseFederalTax,
      additional_federal_tax: additionalFedTax,
      total_federal_tax: totalFederalTax,
      provincial_tax: baseProvincialTax,
      ontario_health_premium: ontarioHealthPremium,
      cpp_contribution: taxDeductions.cpp_contribution || 0,
      ei_premium: taxDeductions.ei_premium || 0,
      total_deductions: totalDeductions,
      net_pay: netPay,
      year_to_date: {
        gross: newYearToDateGross,
        cpp: newYearToDateCPP,
        ei: newYearToDateEI,
        federal_tax: newYearToDateFederalTax,
        provincial_tax: newYearToDateProvincialTax
      },
      wage_breakdown: wageBreakdown,
      lieu_calculation: lieuCalculation,
      has_wage_changes: hasWageChanges,
      calculation_method: taxDeductions.calculation_method || 'cra_compliant'
    };

  } catch (error) {
    console.error('Error in calculateEmployeePay:', error);
    return defaultResult;
  }
};