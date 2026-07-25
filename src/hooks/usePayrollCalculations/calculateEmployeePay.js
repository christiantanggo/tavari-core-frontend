// calculateEmployeePay.js - Main calculation function for employee pay
import { supabase } from '../../supabaseClient';
import { resolveAvailableLieuBalance } from '../../helpers/Payroll/lieuTimeLedger';

/**
 * Calculate employee pay with wage change support and lieu time
 * This is the CORE calculation function
 */
export const calculateEmployeePay = async (
  employee,
  hours,
  yearToDate = {},
  additionalFedTaxAmount = 0,
  payPeriod = null,
  settings = null,
  wageHistory = null,
  canadianTax = null,
  recordAction = null
) => {
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
    year_to_date: {
      gross: 0,
      cpp: 0,
      ei: 0,
      federal_tax: 0,
      provincial_tax: 0
    },
    wage_breakdown: [],
    has_wage_changes: false,
    lieu_calculation: null,
    calculation_details: {
      calculation_method: 'error_fallback',
      is_cra_compliant: false,
      has_wage_changes: false
    }
  };

  if (!employee || !hours || !settings) {
    return defaultResult;
  }

  try {
    const {
      regular_hours = 0,
      overtime_hours = 0,
      lieu_hours = 0,
      premiums = {},
      stat_worked_hours = 0,
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

    if (baseWage <= 0 || regular_hours < 0 || overtime_hours < 0 || lieu_hours < 0) {
      return defaultResult;
    }

    // ============================================================
    // STEP 1: Check for wage changes during pay period
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
    // STEP 2: Calculate LIEU TIME (INDEPENDENT OF WAGE)
    // ============================================================
    let lieuEarned = 0;
    let lieuUsed = 0;
    let lieuBalanceBefore = resolveAvailableLieuBalance(employee);
    let lieuBalanceAfter = lieuBalanceBefore;
    let regularHoursPaid = regular_hours;

    const lieuCalculation = {
      maxHours: 0,
      totalWorkedHours: regular_hours + overtime_hours,
      totalCompensationHours: regular_hours + overtime_hours + stat_worked_hours,
      lieuEarned: 0,
      lieuUsed: 0,
      lieuBalanceBefore: lieuBalanceBefore,
      lieuBalanceAfter: lieuBalanceBefore
    };

    if (employee?.lieu_time_enabled) {
      const maxHours = parseFloat(employee.max_paid_hours_per_period || 0);
      const currentBalance = resolveAvailableLieuBalance(employee);
      const totalCompensationHours = regular_hours + overtime_hours + stat_worked_hours;

      lieuCalculation.maxHours = maxHours;

      if (maxHours > 0) {
        if (totalCompensationHours > maxHours) {
          // EARNING lieu time
          lieuEarned = totalCompensationHours - maxHours;
          regularHoursPaid = Math.max(0, maxHours - stat_worked_hours - overtime_hours);
          lieuBalanceAfter = currentBalance + lieuEarned;

          lieuCalculation.lieuEarned = lieuEarned;
          lieuCalculation.lieuBalanceAfter = lieuBalanceAfter;
        } else if (currentBalance > 0) {
          // USING lieu time - only when balance is available
          const shortfall = maxHours - totalCompensationHours;
          lieuUsed = Math.min(shortfall, currentBalance);
          regularHoursPaid = regular_hours;
          lieuBalanceAfter = currentBalance - lieuUsed;

          lieuCalculation.lieuUsed = lieuUsed;
          lieuCalculation.lieuBalanceAfter = lieuBalanceAfter;
        }
      }
    }

    // ============================================================
    // STEP 3: Calculate pay components (WITH OR WITHOUT WAGE SPLITS)
    // ============================================================
    let regularPay = 0;
    let overtimePay = 0;
    let lieuPay = 0;
    let statHolidayPay = 0;
    let wageBreakdown = [];

    if (hasWageChanges && wagePeriods.length > 0) {
      // ✅ WAGE CHANGED MID-PERIOD
      // Split regular/overtime hours proportionally
      // BUT lieu time uses HIGHEST wage rate (NOT split)
      
      const regularSplits = wageHistory.splitHoursAcrossPeriods(regularHoursPaid, wagePeriods);
      const overtimeSplits = wageHistory.splitHoursAcrossPeriods(overtime_hours, wagePeriods);

      // ✅ LIEU TIME FIX: Pay at highest wage rate
      const highestWage = Math.max(...wagePeriods.map(p => p.wage));
      lieuPay = lieuUsed * highestWage;
      
      // Calculate stat holiday pay at 1.5x using the first period's wage (or highest if stat hours span multiple periods)
      const statWage = wagePeriods.length > 0 ? wagePeriods[0].wage : baseWage;
      statHolidayPay = stat_worked_hours * statWage * 1.5;

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

      console.log(`   📋 WAGE CHANGE Pay breakdown (lieu @ $${highestWage.toFixed(2)}/hr):`, wageBreakdown);
    } else {
      // ✅ NO WAGE CHANGE - Single calculation
      const wage = wagePeriods.length > 0 ? wagePeriods[0].wage : baseWage;

      regularPay = regularHoursPaid * wage;
      overtimePay = overtime_hours * wage * overtimeMultiplier;
      lieuPay = lieuUsed * wage;
      statHolidayPay = stat_worked_hours * wage * 1.5;

      wageBreakdown.push({
        period: payPeriod ? `${payPeriod.start} to ${payPeriod.end}` : 'Full period',
        wage: wage,
        days_in_period: wagePeriods[0]?.daysInPeriod || 14,
        regular_hours: regularHoursPaid,
        regular_pay: regularPay,
        overtime_hours: overtime_hours,
        overtime_pay: overtimePay,
        lieu_hours: lieuUsed,
        lieu_pay: lieuPay,
        subtotal: regularPay + overtimePay + lieuPay,
        is_lieu_payment: false
      });
    }

    // ============================================================
    // STEP 4: Calculate premiums
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
            amount: premiumAmount,
            applies_to_all_hours: premiumData.applies_to_all_hours || false
          };
        }
      });
    }

    // ============================================================
    // STEP 5: Calculate totals and taxes
    // ============================================================
    // Note: statHolidayPay is already calculated above (in STEP 3)
    const grossPay = regularPay + overtimePay + lieuPay + statHolidayPay + totalPremiumPay;
    const vacationPay = settings.auto_calculate_vacation ? (grossPay * vacationPercent) : 0;
    const grossPayWithVacation = grossPay + vacationPay;

    const payFrequency = settings.pay_frequency || 'weekly';
    const payPeriods = payFrequency === 'weekly' ? 52 :
                      payFrequency === 'bi-weekly' ? 26 :
                      payFrequency === 'monthly' ? 12 : 26;

    let taxDeductions = {
      federal_tax: 0,
      provincial_tax: 0,
      cpp_contribution: 0,
      ei_premium: 0,
      calculation_method: 'simplified'
    };

    if (canadianTax && canadianTax.calculateTaxDeductions) {
      try {
        taxDeductions = await canadianTax.calculateTaxDeductions(
          grossPayWithVacation,
          payFrequency,
          claimCode,
          jurisdiction,
          {
            yearToDateGross,
            yearToDateCPP,
            yearToDateEI
          }
        );
      } catch (taxError) {
        console.warn('Tax calculation failed, using simplified:', taxError);
      }
    }

    const baseFederalTax = taxDeductions.federal_tax || 0;
    const totalFederalTax = baseFederalTax + additionalFedTax;
    const baseProvincialTax = taxDeductions.provincial_tax || 0;
    const totalDeductions = totalFederalTax + baseProvincialTax +
                          (taxDeductions.cpp_contribution || 0) +
                          (taxDeductions.ei_premium || 0);
    const netPay = Math.max(0, grossPayWithVacation - totalDeductions);

    // ============================================================
    // STEP 6: Update YTD totals
    // ============================================================
    const newYearToDateGross = yearToDateGross + grossPayWithVacation;
    const newYearToDateFederalTax = yearToDateFederalTax + totalFederalTax;
    const newYearToDateProvincialTax = yearToDateProvincialTax + baseProvincialTax;
    const newYearToDateCPP = yearToDateCPP + (taxDeductions.cpp_contribution || 0);
    const newYearToDateEI = yearToDateEI + (taxDeductions.ei_premium || 0);

    // ============================================================
    // STEP 7: CRA Compliance Check
    // ============================================================
    let complianceCheck = {
      is_cra_compliant: taxDeductions.calculation_method !== 'simplified',
      warnings: [],
      errors: []
    };

    if (canadianTax && canadianTax.validateCRACompliance) {
      try {
        complianceCheck = await canadianTax.validateCRACompliance({
          grossPay: grossPayWithVacation,
          taxDeductions,
          claimCode,
          jurisdiction
        }) || complianceCheck;
      } catch (error) {
        console.warn('Failed to validate CRA compliance:', error);
      }
    }

    // ============================================================
    // Record action
    // ============================================================
    if (recordAction && typeof recordAction === 'function') {
      try {
        await recordAction('calculate_employee_pay', true);
      } catch (actionError) {
        console.warn('Failed to record action:', actionError);
      }
    }

    // ============================================================
    // RETURN COMPLETE CALCULATION RESULT
    // ============================================================
    return {
      employee_id: employee.id,
      regular_hours: regular_hours,
      regular_hours_worked: regular_hours,
      regular_hours_paid: regularHoursPaid,
      overtime_hours: overtime_hours,
      lieu_hours: lieuUsed,
      lieu_earned: lieuEarned,
      lieu_used: lieuUsed,
      lieu_balance_before: lieuBalanceBefore,
      lieu_balance_after: lieuBalanceAfter,
      lieu_balance: lieuBalanceAfter,
      stat_holiday_hours: stat_worked_hours,
      stat_holiday_pay: statHolidayPay,
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
      base_provincial_tax: baseProvincialTax,
      ontario_health_premium: 0,
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
      has_wage_changes: hasWageChanges,
      lieu_calculation: lieuCalculation,
      cra_compliance: complianceCheck,
      calculation_details: {
        calculation_method: taxDeductions.calculation_method || 'simplified',
        is_cra_compliant: complianceCheck.is_cra_compliant,
        has_wage_changes: hasWageChanges,
        pay_frequency: payFrequency,
        claim_code: claimCode,
        jurisdiction: jurisdiction
      }
    };

  } catch (error) {
    console.error('Error in calculateEmployeePay:', error);
    return {
      ...defaultResult,
      calculation_details: {
        calculation_method: 'error',
        error: error.message,
        is_cra_compliant: false,
        has_wage_changes: false
      }
    };
  }
};