// hooks/usePayrollCalculations.js - MAIN EXPORT FILE
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useSecurityContext } from '../Security';
import { usePOSAuth } from './usePOSAuth';
import { useCanadianTaxCalculations } from './useCanadianTaxCalculations';

// ============================================================
// WAGEHISTORY CLASS - EMBEDDED
// ============================================================
class WageHistory {
  constructor(businessId) {
    this.businessId = businessId;
  }

  async getWagePeriodsInRange(employeeId, startDate, endDate) {
    if (!employeeId || !startDate || !endDate) {
      console.warn('Missing required parameters for getWagePeriodsInRange');
      return [];
    }

    try {
      const { data: employee, error: employeeError } = await supabase
        .from('users')
        .select('wage')
        .eq('id', employeeId)
        .single();

      if (employeeError) throw employeeError;

      const currentWage = parseFloat(employee?.wage || 0);

      const { data: wageChanges, error: wageError } = await supabase
        .from('hrpayroll_wage_history')
        .select('*')
        .eq('business_id', this.businessId)
        .eq('user_id', employeeId)
        .lte('effective_date', endDate)
        .order('effective_date', { ascending: true });

      if (wageError) {
        console.error('Error fetching wage changes:', wageError);
        return [{
          wage: currentWage,
          startDate: startDate,
          endDate: endDate,
          daysInPeriod: this.calculateDaysBetween(startDate, endDate)
        }];
      }

      if (!wageChanges || wageChanges.length === 0) {
        return [{
          wage: currentWage,
          startDate: startDate,
          endDate: endDate,
          daysInPeriod: this.calculateDaysBetween(startDate, endDate)
        }];
      }

      const periods = [];
      let periodStart = startDate;

      const sortedChanges = wageChanges
        .filter(change => change.effective_date >= startDate && change.effective_date <= endDate)
        .map(change => ({
          effectiveDate: change.effective_date,
          previousWage: parseFloat(change.previous_wage || 0),
          newWage: parseFloat(change.new_wage || 0)
        }))
        .sort((a, b) => new Date(a.effectiveDate) - new Date(b.effectiveDate));

      if (sortedChanges.length === 0) {
        const previousWage = wageChanges[wageChanges.length - 1];
        return [{
          wage: parseFloat(previousWage.new_wage),
          startDate: startDate,
          endDate: endDate,
          daysInPeriod: this.calculateDaysBetween(startDate, endDate)
        }];
      }

      const firstChange = sortedChanges[0];
      if (firstChange.effectiveDate > startDate) {
        const wageBeforeFirst = wageChanges.find(c => c.effective_date < startDate);
        const startingWage = wageBeforeFirst ? parseFloat(wageBeforeFirst.new_wage) : firstChange.previousWage;
        
        periods.push({
          wage: startingWage,
          startDate: startDate,
          endDate: this.subtractDays(firstChange.effectiveDate, 1),
          daysInPeriod: this.calculateDaysBetween(startDate, this.subtractDays(firstChange.effectiveDate, 1))
        });
      }

      for (let i = 0; i < sortedChanges.length; i++) {
        const change = sortedChanges[i];
        const nextChange = sortedChanges[i + 1];
        
        const periodEndDate = nextChange 
          ? this.subtractDays(nextChange.effectiveDate, 1)
          : endDate;

        periods.push({
          wage: change.newWage,
          startDate: change.effectiveDate,
          endDate: periodEndDate,
          daysInPeriod: this.calculateDaysBetween(change.effectiveDate, periodEndDate)
        });
      }

      return periods;

    } catch (error) {
      console.error('Error in getWagePeriodsInRange:', error);
      const { data: employee } = await supabase
        .from('users')
        .select('wage')
        .eq('id', employeeId)
        .single();

      return [{
        wage: parseFloat(employee?.wage || 0),
        startDate: startDate,
        endDate: endDate,
        daysInPeriod: this.calculateDaysBetween(startDate, endDate)
      }];
    }
  }

  splitHoursAcrossPeriods(totalHours, wagePeriods) {
    if (!wagePeriods || wagePeriods.length === 0) return [];

    if (wagePeriods.length === 1) {
      return [{
        hours: totalHours,
        wage: wagePeriods[0].wage,
        pay: totalHours * wagePeriods[0].wage,
        startDate: wagePeriods[0].startDate,
        endDate: wagePeriods[0].endDate,
        daysInPeriod: wagePeriods[0].daysInPeriod
      }];
    }

    const totalDays = wagePeriods.reduce((sum, period) => sum + period.daysInPeriod, 0);

    const splits = wagePeriods.map(period => {
      const proportion = period.daysInPeriod / totalDays;
      const hours = totalHours * proportion;
      const pay = hours * period.wage;

      return {
        hours: Math.round(hours * 100) / 100,
        wage: period.wage,
        pay: Math.round(pay * 100) / 100,
        startDate: period.startDate,
        endDate: period.endDate,
        daysInPeriod: period.daysInPeriod
      };
    });

    return splits;
  }

  calculateDaysBetween(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays + 1;
  }

  subtractDays(dateString, days) {
    const date = new Date(dateString);
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  addDays(dateString, days) {
    const date = new Date(dateString);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }

  async getWageChangeHistory(employeeId) {
    try {
      const { data: wageChanges, error } = await supabase
        .from('hrpayroll_wage_history')
        .select(`
          *,
          created_by_user:users!created_by(first_name, last_name, full_name, email)
        `)
        .eq('business_id', this.businessId)
        .eq('user_id', employeeId)
        .order('effective_date', { ascending: false });

      if (error) throw error;
      return wageChanges || [];
    } catch (error) {
      console.error('Error fetching wage change history:', error);
      return [];
    }
  }
}

// ============================================================
// MAIN HOOK
// ============================================================
export const usePayrollCalculations = (businessId) => {
  const [settings, setSettings] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [payrollRuns, setPayrollRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [wageHistory, setWageHistory] = useState(null);

  const {
    validateInput,
    recordAction
  } = useSecurityContext({
    componentName: 'usePayrollCalculations',
    sensitiveComponent: false,
    enableRateLimiting: false,
    enableAuditLogging: false,
    securityLevel: 'low'
  });

  const {
    selectedBusinessId,
    authUser,
    userRole,
    businessData
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager'],
    requireBusiness: true,
    componentName: 'usePayrollCalculations'
  });

  const canadianTax = useCanadianTaxCalculations(businessId);

  useEffect(() => {
    if (businessId) {
      const wageHistoryInstance = new WageHistory(businessId);
      setWageHistory(wageHistoryInstance);
    }
  }, [businessId]);

  const loadData = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: settingsData, error: settingsError } = await supabase
        .from('hrpayroll_settings')
        .select('*')
        .eq('business_id', businessId)
        .single();

      if (settingsError && settingsError.code !== 'PGRST116') {
        throw settingsError;
      }

      const { data: runsData, error: runsError } = await supabase
        .from('hrpayroll_runs')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (runsError) {
        console.warn('Error loading payroll runs:', runsError);
      }

      const { data: businessUsers, error: businessUsersError } = await supabase
        .from('business_users')
        .select('user_id')
        .eq('business_id', businessId);

      if (businessUsersError) throw businessUsersError;

      const userIds = businessUsers.map(bu => bu.user_id);

      let employeeData = [];
      if (userIds.length > 0) {
        const { data: usersData, error: usersError } = await supabase
          .from('users')
          .select(`
            *,
            hrpayroll_employee_premiums!hrpayroll_employee_premiums_user_id_fkey(*)
          `)
          .in('id', userIds)
          .neq('employment_status', 'terminated');

        if (usersError) throw usersError;
        employeeData = usersData || [];
      }

      const { data: premiumData, error: premiumError } = await supabase
        .from('hrpayroll_employee_premiums')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .in('user_id', userIds);

      if (premiumError) {
        console.warn('Error loading premiums:', premiumError);
      }

      if (employeeData && premiumData) {
        employeeData.forEach(emp => {
          emp.hrpayroll_employee_premiums = premiumData.filter(p => p.user_id === emp.id);
        });
      }

      setSettings(settingsData);
      setEmployees(employeeData || []);
      setPayrollRuns(runsData || []);

      try {
        if (recordAction && typeof recordAction === 'function') {
          await recordAction('load_payroll_data', true);
        }
      } catch (actionError) {
        console.warn('Failed to record action:', actionError);
      }

    } catch (err) {
      console.error('Error loading payroll data:', err);
      setError(`Failed to load payroll data: ${err.message}`);
      
      try {
        if (recordAction && typeof recordAction === 'function') {
          await recordAction('load_payroll_data', false);
        }
      } catch (actionError) {
        console.warn('Failed to record error action:', actionError);
      }
    } finally {
      setLoading(false);
    }
  }, [businessId, recordAction]);

  // ============================================================
  // CALCULATE EMPLOYEE PAY - WITH LIEU TIME FIX
  // ============================================================
  const calculateEmployeePay = useCallback(async (
    employee, 
    hours, 
    yearToDate = {}, 
    additionalFedTaxAmount = 0,
    payPeriod = null
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

      const baseWage = parseFloat(employee.wage || 0);
      const vacationPercent = parseFloat(employee.vacation_percent || settings.default_vacation_percent || 0.04);
      const overtimeMultiplier = parseFloat(settings.overtime_multiplier || 1.5);
      const claimCode = parseInt(employee.claim_code || settings.default_claim_code || 1);
      const additionalFedTax = parseFloat(additionalFedTaxAmount || 0);
      const jurisdiction = settings.tax_jurisdiction || 'ON';

      if (baseWage <= 0) {
        return defaultResult;
      }

      // Calculate total hours
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

      // âœ… LIEU TIME CALCULATION (INDEPENDENT OF WAGE) - WITH AUTO-FILL + HOLIDAY PAY
      let lieuEarned = 0;
      let lieuUsed = 0;
      let regularHoursPaid = actualRegularHours;
      const lieuBalanceBefore = parseFloat(employee.lieu_time_balance || 0);
      let lieuBalanceAfter = lieuBalanceBefore;
      
      // âœ… FIXED: Get holiday pay amount and convert to equivalent hours
      const holidayPayAmount = parseFloat(hours.holiday_pay || 0);
      const holidayPayHours = holidayPayAmount > 0 && baseWage > 0 ? 
        (holidayPayAmount / baseWage) : 0;
      
      const lieuCalculation = {
        enabled: employee.lieu_time_enabled || false,
        maxHours: parseFloat(employee.max_paid_hours_per_period || 0),
        totalWorkedHours: actualTotalHours,
        statHours: parseFloat(stat_worked_hours || 0),
        holidayPayHours: holidayPayHours,
        lieuEarned: 0,
        lieuUsed: 0,
        lieuBalanceBefore: lieuBalanceBefore,
        lieuBalanceAfter: lieuBalanceBefore
      };

      if (employee?.lieu_time_enabled) {
        const maxHours = parseFloat(employee.max_paid_hours_per_period || 0);
        const currentBalance = parseFloat(employee.lieu_time_balance || 0);
        
        // âœ… CRITICAL: Include ALL compensation hours (worked + stat + holiday pay)
        const totalCompensationHours = actualTotalHours + parseFloat(stat_worked_hours || 0) + holidayPayHours;
        
        console.log('ðŸ” LIEU CALCULATION DEBUG:', {
          employee: `${employee.first_name} ${employee.last_name}`,
          maxHours: maxHours,
          actualTotalHours: actualTotalHours,
          statHours: parseFloat(stat_worked_hours || 0),
          holidayPayAmount: holidayPayAmount,
          holidayPayHours: holidayPayHours,
          totalCompensationHours: totalCompensationHours,
          currentLieuBalance: currentBalance
        });
        
        if (maxHours > 0) {
          if (totalCompensationHours > maxHours) {
            // âœ… OVER MAX: Employee earns lieu time
            lieuEarned = totalCompensationHours - maxHours;
            regularHoursPaid = Math.max(0, maxHours - parseFloat(stat_worked_hours || 0) - actualOvertimeHours - holidayPayHours);
            lieuBalanceAfter = currentBalance + lieuEarned;
            
            console.log('ðŸ’° LIEU EARNED:', {
              earned: lieuEarned,
              newBalance: lieuBalanceAfter
            });
          } else {
            // âœ… UNDER MAX: Auto-fill with lieu time to reach max hours
            const shortfall = maxHours - totalCompensationHours;
            lieuUsed = Math.min(shortfall, currentBalance);
            regularHoursPaid = actualRegularHours;  // FIX: Don't add lieu hours - paid separately as lieuPay
            lieuBalanceAfter = currentBalance - lieuUsed;
            
            console.log('ðŸ”„ LIEU AUTO-USED:', {
              shortfall: shortfall,
              lieuUsed: lieuUsed,
              regularHoursPaid: regularHoursPaid,
              newBalance: lieuBalanceAfter
            });
          }
        }

        lieuCalculation.lieuEarned = lieuEarned;
        lieuCalculation.lieuUsed = lieuUsed;
        lieuCalculation.lieuBalanceAfter = lieuBalanceAfter;
      }

      // Check for wage changes
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
            console.log(`ðŸ’° WAGE CHANGE DETECTED for ${employee.first_name} ${employee.last_name}`);
          }
        } catch (wageError) {
          console.error('Error getting wage periods:', wageError);
          wagePeriods = [];
          hasWageChanges = false;
        }
      }

      // âœ… CALCULATE PAY WITH LIEU TIME FIX
      let regularPay = 0;
      let overtimePay = 0;
      let lieuPay = 0;
      let wageBreakdown = [];

      if (hasWageChanges && wagePeriods.length > 0) {
        // WAGE CHANGED MID-PERIOD
        const regularSplits = wageHistory.splitHoursAcrossPeriods(regularHoursPaid, wagePeriods);
        const overtimeSplits = wageHistory.splitHoursAcrossPeriods(actualOvertimeHours, wagePeriods);
        
        // âœ… LIEU TIME: Pay at HIGHEST wage rate
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
        
        // âœ… Add separate entry for lieu time
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

        console.log(`   ðŸ’° Pay breakdown with lieu @ $${highestWage.toFixed(2)}/hr`);
      } else {
        // NO WAGE CHANGE
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

      // Calculate premiums
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

      // Calculate totals
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
          gross: yearToDateGross + grossPayWithVacation,
          cpp: yearToDateCPP + (taxDeductions.cpp_contribution || 0),
          ei: yearToDateEI + (taxDeductions.ei_premium || 0),
          federal_tax: yearToDateFederalTax + totalFederalTax,
          provincial_tax: yearToDateProvincialTax + baseProvincialTax
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
  }, [settings, wageHistory, canadianTax, recordAction]);

  const calculatePayrollSummary = useCallback((payrollEntries) => {
    if (!Array.isArray(payrollEntries)) {
      return {
        totalEmployees: 0,
        totalHours: 0,
        totalGrossPay: 0,
        totalNetPay: 0
      };
    }

    return payrollEntries.reduce((summary, entry) => {
      return {
        totalEmployees: summary.totalEmployees + 1,
        totalHours: summary.totalHours + (parseFloat(entry.total_hours) || 0),
        totalGrossPay: summary.totalGrossPay + (parseFloat(entry.gross_pay) || 0),
        totalNetPay: summary.totalNetPay + (parseFloat(entry.net_pay) || 0)
      };
    }, {
      totalEmployees: 0,
      totalHours: 0,
      totalGrossPay: 0,
      totalNetPay: 0
    });
  }, []);

  const validatePayrollInputs = useCallback(async (employee, hours) => {
    const errors = [];
    const warnings = [];

    if (!employee) {
      errors.push('Employee data is required');
    }
    if (!hours) {
      errors.push('Hours data is required');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return {
    settings,
    employees,
    payrollRuns,
    loading,
    error,
    calculateEmployeePay,
    calculatePayrollSummary,
    validatePayrollInputs,
    refreshData: loadData,
    loadData,
    wageHistory
  };
};

export default usePayrollCalculations;