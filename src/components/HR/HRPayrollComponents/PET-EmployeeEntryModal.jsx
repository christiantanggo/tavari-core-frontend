// components/HR/HRPayrollComponents/PET-EmployeeEntryModal.jsx - COMPLETE REWRITE WITH WORKING HOLIDAY PAY
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';
import PETPremiumHoursSection from './PET-PremiumHoursSection';
import HolidayPayCalculator from './HolidayPayCalculator';
import { useCanadianTaxCalculations } from '../../../hooks/useCanadianTaxCalculations';
import { useOntarioHealthPremium } from '../../../hooks/useOntarioHealthPremium';
import { usePayrollCalculations } from '../../../hooks/usePayrollCalculations';
import WagePeriodHoursModal from './WagePeriodHoursModal';
import { calculatePayFrequencyFromDates } from '../../../utils/calculatePayPeriodNumber';
import { computeAutoLieuForPeriod } from '../../../helpers/Payroll/computeAutoLieuForPeriod';
import {
  clampLieuHoursForPeriod
} from '../../../helpers/Payroll/lieuTimeLedger';
import { getCanadianStatHolidaysForPeriod } from '../../../utils/canadianStatHolidays';

const PETEmployeeEntryModal = ({ 
  isOpen, 
  onClose, 
  employee, 
  hours, 
  additionalFedTax, 
  statHolidayPay,
  premiums, 
  allPremiums, 
  onSave, 
  formatTaxAmount,
  isEmployeePremiumEnabled,
  getEmployeePremiumRate,
  getEmployeePremiumRateType,
  getEmployeePreview,
  selectedBusinessId,
  businessData,
  settings,
  payPeriod,
  onHolidayPayChange,
  employeeHolidayPay,
  employeeHolidayDetails
}) => {
  const [localHours, setLocalHours] = useState(hours || { 
    total_hours: 0, 
    overtime_hours: 0, 
    stat_worked_hours: 0,
    lieu_earned: 0,
    lieu_used: 0,
    lieu_balance: 0,
    premium_hours: {},
    wage_period_hours: []
  });
  const [localAdditionalFedTax, setLocalAdditionalFedTax] = useState(additionalFedTax || 0);
  const [holidayPayEnabled, setHolidayPayEnabled] = useState(false);
  const [holidayDate, setHolidayDate] = useState('');
  const [missedShiftBefore, setMissedShiftBefore] = useState(false);
  const [missedShiftAfter, setMissedShiftAfter] = useState(false);
  const [localHolidayPay, setLocalHolidayPay] = useState(0);
  const [localHolidayDetails, setLocalHolidayDetails] = useState(null);
  const [showWagePeriodModal, setShowWagePeriodModal] = useState(false);
  const [wagePeriods, setWagePeriods] = useState([]);
  const [hasWageChange, setHasWageChange] = useState(false);
  /** When true, auto-lieu effect must not overwrite lieu_earned/lieu_used the user typed. */
  const lieuManuallyEditedRef = useRef(false);

  const {
    validateInput,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'PETEmployeeEntryModal',
    sensitiveComponent: true,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  const canadianTax = useCanadianTaxCalculations(selectedBusinessId);
  const ontarioHealthPremium = useOntarioHealthPremium(
    0,
    settings?.pay_frequency === 'weekly' ? 52 : 
    settings?.pay_frequency === 'bi-weekly' ? 26 : 
    settings?.pay_frequency === 'monthly' ? 12 : 24
  );
  const payrollCalc = usePayrollCalculations(selectedBusinessId);

  useEffect(() => {
    if (isOpen && hours) {
      lieuManuallyEditedRef.current = false;
      const statWorked =
        parseFloat(hours.stat_worked_hours ?? statHolidayPay ?? 0) || 0;
      const holidayPayAmount =
        holidayPayEnabled && !missedShiftBefore && !missedShiftAfter ? localHolidayPay : 0;
      if (employee?.lieu_time_enabled) {
        const auto = computeAutoLieuForPeriod({
          employee,
          totalWorkedHours: hours.total_hours,
          statHolidayHours: statWorked,
          holidayPayAmount
        });
        setLocalHours({
          ...hours,
          stat_worked_hours: statWorked,
          lieu_earned: auto.lieuEarned,
          lieu_used: auto.lieuUsed,
          lieu_balance: auto.lieuBalanceAfter
        });
      } else {
        setLocalHours({
          ...hours,
          stat_worked_hours: statWorked
        });
      }
    }
  }, [isOpen, hours, statHolidayPay, employee?.id, employee?.lieu_time_enabled, employee?.lieu_time_balance, employee?.max_paid_hours_per_period]);

  useEffect(() => {
    if (isOpen && additionalFedTax !== undefined) {
      setLocalAdditionalFedTax(additionalFedTax || 0);
    }
  }, [isOpen, additionalFedTax]);

  useEffect(() => {
    if (isOpen && employeeHolidayPay && employeeHolidayPay[employee?.id]) {
      const existingHolidayPay = employeeHolidayPay[employee.id];
      const existingDetails = employeeHolidayDetails?.[employee.id];
      
      if (existingHolidayPay > 0) {
        setHolidayPayEnabled(true);
        setLocalHolidayPay(existingHolidayPay);
        setLocalHolidayDetails(existingDetails);
        setHolidayDate(existingDetails?.holidayDate || '');
        setMissedShiftBefore(existingDetails?.missedShiftBefore || false);
        setMissedShiftAfter(existingDetails?.missedShiftAfter || false);
      }
    }
  }, [isOpen, employee?.id, employeeHolidayPay, employeeHolidayDetails]);

  // When this pay period includes a stat holiday, pre-enable public holiday pay.
  useEffect(() => {
    if (!isOpen || !employee?.id || !payPeriod?.start || !payPeriod?.end) return;
    if (employeeHolidayPay?.[employee.id] > 0) return;

    const workedHours =
      (parseFloat(localHours.total_hours) || 0) +
      (parseFloat(localHours.stat_worked_hours) || 0) +
      (parseFloat(hours?.total_hours) || 0) +
      (parseFloat(hours?.stat_worked_hours) || 0) +
      (parseFloat(statHolidayPay) || 0);
    if (workedHours <= 0) return;
    if (holidayPayEnabled && holidayDate) return;

    const holidaysInPeriod = getCanadianStatHolidaysForPeriod({
      jurisdiction: settings?.tax_jurisdiction || 'ON',
      periodStart: payPeriod.start,
      periodEnd: payPeriod.end
    });
    if (!holidaysInPeriod.length) return;

    // Only auto-enable for a holiday that actually falls in this pay period
    const pick =
      holidaysInPeriod.find((h) => h.name === 'Canada Day') || holidaysInPeriod[0];
    setHolidayPayEnabled(true);
    setHolidayDate(pick.date);
  }, [
    isOpen,
    employee?.id,
    payPeriod?.start,
    payPeriod?.end,
    localHours.total_hours,
    localHours.stat_worked_hours,
    hours?.total_hours,
    hours?.stat_worked_hours,
    statHolidayPay,
    settings?.tax_jurisdiction,
    employeeHolidayPay,
    holidayPayEnabled,
    holidayDate
  ]);

  // Lieu auto-fill is driven by calculatedPreview (see sync effect below). The previous async path
  // duplicated that work via the parent's getEmployeePreview and raced with it, occasionally writing
  // 0s back into localHours.lieu_earned/lieu_used and leaving the inputs blank even though the
  // preview block showed the correct lieu values. Removed intentionally.

  const handleClose = () => {
    setLocalHours({ 
      total_hours: 0, 
      overtime_hours: 0, 
      stat_worked_hours: 0,
      lieu_earned: 0,
      lieu_used: 0,
      lieu_balance: 0,
      premium_hours: {},
      wage_period_hours: []
    });
    setLocalAdditionalFedTax(0);
    setHolidayPayEnabled(false);
    setHolidayDate('');
    setMissedShiftBefore(false);
    setMissedShiftAfter(false);
    setLocalHolidayPay(0);
    setLocalHolidayDetails(null);
    setShowWagePeriodModal(false);
    setWagePeriods([]);
    setHasWageChange(false);
    onClose();
  };

  useEffect(() => {
    if (!isOpen || !employee?.id || !payPeriod?.start || !payPeriod?.end || !payrollCalc?.wageHistory) {
      setHasWageChange(false);
      setWagePeriods([]);
      return;
    }

    const checkWageChanges = async () => {
      try {
        const periods = await payrollCalc.wageHistory.getWagePeriodsInRange(
          employee.id,
          payPeriod.start,
          payPeriod.end
        );
        
        if (periods && periods.length > 1) {
          setHasWageChange(true);
          setWagePeriods(periods);
        } else {
          setHasWageChange(false);
          setWagePeriods([]);
        }
      } catch (error) {
        console.error('Error checking wage changes:', error);
        setHasWageChange(false);
        setWagePeriods([]);
      }
    };

    checkWageChanges();
  }, [isOpen, employee?.id, payPeriod, payrollCalc?.wageHistory]);

  const calculatedPreview = useMemo(() => {
    if (!employee || !canadianTax || !payrollCalc || !settings) {
      return {
        gross_pay: 0,
        vacation_pay: 0,
        federal_tax: 0,
        provincial_tax: 0,
        ontario_health_premium: 0,
        ei_premium: 0,
        cpp_contribution: 0,
        total_deductions: 0,
        net_pay: 0,
        lieu_earned: 0,
        lieu_used: 0,
        lieu_balance_before: 0,
        lieu_balance_after: 0,
        calculation_method: 'hooks_not_ready'
      };
    }

    try {
      const wage = parseFloat(employee.wage || 0);
      const totalWorkedHours = parseFloat(localHours.total_hours || 0);
      const overtimeHours = parseFloat(localHours.overtime_hours || 0);
      const statHolidayHours = parseFloat(localHours.stat_worked_hours || 0);
      const holidayPayAmount =
        holidayPayEnabled && !missedShiftBefore && !missedShiftAfter ? localHolidayPay : 0;

      const clampedLieu = clampLieuHoursForPeriod({
        employee,
        lieuEarned: localHours.lieu_earned,
        lieuUsed: localHours.lieu_used
      });
      const lieuEarned = clampedLieu.lieuEarned;
      const lieuUsed = clampedLieu.lieuUsed;
      const lieuBalanceAfter = clampedLieu.lieuBalanceAfter;
      const currentLieuBalance = clampedLieu.lieuBalanceBefore;
      const holidayPayHours = holidayPayAmount > 0 && wage > 0 ? holidayPayAmount / wage : 0;

      let regularHours = totalWorkedHours - overtimeHours - statHolidayHours;
      if (regularHours < 0) regularHours = 0;

      // Calculate regularHoursPaid (hours actually paid, considering max_paid_hours_per_period)
      let regularHoursPaid = regularHours;
      if (employee?.lieu_time_enabled) {
        const maxHours = parseFloat(employee.max_paid_hours_per_period || 0);
        if (maxHours > 0) {
          const totalCompensationHours = totalWorkedHours + statHolidayHours + holidayPayHours;
          if (totalCompensationHours > maxHours) {
            // Over max: pay up to max, minus stat, holiday, and overtime
            regularHoursPaid = Math.max(0, maxHours - statHolidayHours - holidayPayHours - overtimeHours);
          } else {
            // Under max: keep base hours at what was worked; lieu hours are paid separately
            regularHoursPaid = regularHours;
          }
        }
      }

      let regularPay = 0;
      let wageBreakdown = null;

      if (hasWageChange && localHours.wage_period_hours && localHours.wage_period_hours.length > 0) {
        wageBreakdown = localHours.wage_period_hours.map(period => ({
          start_date: period.start_date,
          end_date: period.end_date,
          wage: period.wage,
          hours: period.hours,
          pay: period.hours * period.wage
        }));
        regularPay = wageBreakdown.reduce((sum, period) => sum + period.pay, 0);
      } else {
        // Use regularHoursPaid for pay calculation (considering max_paid_hours_per_period)
        regularPay = regularHoursPaid * wage;
        wageBreakdown = [{
          start_date: payPeriod?.start,
          end_date: payPeriod?.end,
          wage: wage,
          hours: regularHoursPaid,
          pay: regularPay
        }];
      }

      const overtimePay = overtimeHours * wage * 1.5;
      const statHolidayPay = statHolidayHours * wage * 1.5;

      let premiumPay = 0;
      if (allPremiums && Array.isArray(allPremiums)) {
        allPremiums.forEach(premium => {
          if (premium && premium.name && isEmployeePremiumEnabled(employee.id, premium.name)) {
            const premiumHours = parseFloat(localHours.premium_hours?.[premium.name] || 0);
            if (premiumHours > 0) {
              const premiumRate = getEmployeePremiumRate(employee.id, premium.name);
              const rateType = getEmployeePremiumRateType(employee.id, premium.name);
              
              if (rateType === 'percentage') {
                // Use regularHoursPaid for percentage calculation, not regularHours
                // This ensures premiums are calculated on paid hours, not total worked hours
                const regularHoursForPremium = regularHoursPaid > 0 ? regularHoursPaid : regularHours;
                premiumPay += (regularPay / Math.max(regularHoursForPremium, 1)) * premiumHours * (premiumRate / 100);
              } else {
                premiumPay += premiumHours * premiumRate;
              }
            }
          }
        });
      }

      const lieuPay = lieuUsed * wage;
      const grossPay = regularPay + overtimePay + lieuPay + statHolidayPay + premiumPay;
      
      // Calculate vacation percent based on years of service (ESA requirement: 4% for <5 years, 6% for 5+ years)
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
      
      let vacationPercent = calculateVacationPercent(employee, settings?.default_vacation_percent);
      
      const vacationPay = grossPay * vacationPercent;
      const vacationPercentDisplay = (vacationPercent * 100).toFixed(2);  // For display as percentage
      
      const totalIncome = grossPay + vacationPay + holidayPayAmount;

      const claimCode = parseInt(employee.claim_code || 1);
      const jurisdiction = settings?.tax_jurisdiction || 'ON';
      
      // Determine pay frequency: Use business settings as primary source, period dates as fallback
      // Business settings are authoritative since period dates can vary (e.g., bi-weekly might be 13-15 days)
      let payFrequency, payPeriods;
      
      // CRITICAL FIX: Always check settings.pay_frequency first - it's the source of truth
      // Check multiple possible sources for pay_frequency
      const businessPayFrequency = settings?.pay_frequency || 
                                   payrollCalc?.settings?.pay_frequency ||
                                   canadianTax?.taxSettings?.pay_frequency;
      
      console.log('[PET-EmployeeEntryModal] Pay frequency sources:', {
        'settings.pay_frequency': settings?.pay_frequency,
        'payrollCalc.settings.pay_frequency': payrollCalc?.settings?.pay_frequency,
        'canadianTax.taxSettings.pay_frequency': canadianTax?.taxSettings?.pay_frequency,
        'selected businessPayFrequency': businessPayFrequency
      });
      
      // Priority 1: Use business settings (most reliable)
      if (businessPayFrequency) {
        payFrequency = businessPayFrequency;
        payPeriods = payFrequency === 'weekly' ? 52 : 
                    (payFrequency === 'bi_weekly' || payFrequency === 'bi-weekly') ? 26 : 
                    payFrequency === 'monthly' ? 12 : 
                    payFrequency === 'semi_monthly' ? 24 : 26;
        
        console.log('[PET-EmployeeEntryModal] Using business pay frequency:', {
          payFrequency,
          payPeriods,
          source: 'business_settings'
        });
      } else {
        // Priority 2: Calculate from period dates if available
        const periodStart = payPeriod?.pay_period_start || payPeriod?.start;
        const periodEnd = payPeriod?.pay_period_end || payPeriod?.end;
        
        if (periodStart && periodEnd) {
          const calculated = calculatePayFrequencyFromDates(periodStart, periodEnd);
          payFrequency = calculated.frequency || 'bi_weekly';
          payPeriods = calculated.periodsPerYear || 26;
          
          console.log('[PET-EmployeeEntryModal] Pay frequency calculated from period dates:', {
            periodStart,
            periodEnd,
            calculatedFrequency: calculated.frequency,
            calculatedPeriods: calculated.periodsPerYear,
            finalFrequency: payFrequency,
            finalPeriods: payPeriods
          });
        } else {
          // Priority 3: Default fallback - BUT LOG A WARNING
          payFrequency = 'bi_weekly';
          payPeriods = 26;
          
          console.error('[PET-EmployeeEntryModal] ⚠️ WARNING: Pay frequency using default (no settings or dates):', {
            finalFrequency: payFrequency,
            finalPeriods: payPeriods,
            warning: 'This may be incorrect! Check business payroll settings.'
          });
        }
      }

      // Get tax year from canadianTax hook (which loads from database) or fall back to settings prop.
      // Defaults to 2026 (current CRA T4127 122nd Edition).
      const effectiveTaxYear = canadianTax?.taxSettings?.tax_year || settings?.tax_year || 2026;
      // Removed excessive logging - only log if calculation inputs actually changed
      // This reduces console spam when premium hours or other UI elements update

      // Get period end date from payPeriod prop or use current date
      const periodEndDate = payPeriod?.pay_period_end || payPeriod?.end || new Date().toISOString().split('T')[0];
      
      // Get year-to-date totals (for now defaulting to 0, but structure is ready for actual YTD data)
      // TODO: Integrate with useYTDCalculations hook to get actual year-to-date tax amounts
      const yearToDateFederalTax = 0; // Will be populated from YTD calculations
      const yearToDateProvincialTax = 0; // Will be populated from YTD calculations
      const yearToDateGross = 0; // Will be populated from YTD calculations

      // DEBUG: Log what we're passing to the calculation
      console.log('[PET-EmployeeEntryModal] DEBUG - Tax calculation inputs:', {
        totalIncome,
        payPeriods,
        payFrequency,
        expectedAnnualIncome: totalIncome * payPeriods,
        claimCode,
        jurisdiction,
        effectiveTaxYear
      });
      
      const craCalculation = canadianTax.calculateCRACompliantTaxes({
        grossPay: totalIncome,
        payPeriods: payPeriods,
        claimCode: claimCode,
        jurisdiction: jurisdiction,
        yearToDateTotals: {
          yearToDateGross: yearToDateGross,
          yearToDateEI: 0,
          yearToDateCPP: 0,
          yearToDateFederalTax: yearToDateFederalTax,
          yearToDateProvincialTax: yearToDateProvincialTax
        },
        taxYear: effectiveTaxYear,
        periodEndDate: periodEndDate,
        useCumulativeAveraging: true // Enable Option 2: Cumulative Averaging
      });

      // Debug: Log calculation results
      console.log('[PET-EmployeeEntryModal] CRA Calculation Result:', {
        federal_tax_period: craCalculation.federal_tax_period,
        provincial_tax_period: craCalculation.provincial_tax_period,
        ei_premium: craCalculation.ei_premium,
        cpp_contribution: craCalculation.cpp_contribution,
        cpp2_contribution: craCalculation.cpp2_contribution,
        tax_year_used: craCalculation.cra_compliance?.tax_year,
        document_reference: craCalculation.cra_compliance?.document_reference
      });

      const baseFederalTax = craCalculation.federal_tax_period || 0;
      const additionalTax = parseFloat(localAdditionalFedTax) || 0;
      const totalFederalTax = baseFederalTax + additionalTax;

      const baseProvincialTax = craCalculation.provincial_tax_period || 0;
      // CRITICAL FIX: OHP (Ontario Health Premium) is already included in provincial_tax_period from CRA calculation
      // The CRA calculation includes V2 (OHP) in the final provincial tax: T2 = T4 + V1 + V2 - S
      // So we should NOT add it again here - that would double it!
      // Extract OHP from the CRA calculation result if available for display purposes
      const ohp = craCalculation.provincial_calculation?.ontario_details?.V2_per_period ||
                  craCalculation.provincial_calculation?.ontario_health_premium_period || 0;
      // OHP is already included in baseProvincialTax, so totalProvincialTax = baseProvincialTax
      const totalProvincialTax = baseProvincialTax;
      const eiPremium = craCalculation.ei_premium || 0;
      // cppContribution is the COMBINED total (base + first additional + CPP2) actually deducted from the paycheque.
      // Surface CPP2 separately in case downstream UI/T4 reporting needs it.
      const cppContribution = craCalculation.cpp_contribution || 0;
      const cpp2Contribution = craCalculation.cpp2_contribution || 0;
      const cppBaseContribution = craCalculation.cpp_base_contribution || (cppContribution - cpp2Contribution);

      const totalDeductions = totalFederalTax + totalProvincialTax + eiPremium + cppContribution;
      const netPay = Math.max(0, totalIncome - totalDeductions);

      // DEBUG: Log the calculation
      console.log('[PET-EmployeeEntryModal] CALCULATED DEDUCTIONS:', {
        baseFederalTax,
        additionalTax,
        totalFederalTax,
        baseProvincialTax,
        totalProvincialTax,
        eiPremium,
        cppContribution,
        totalDeductions,
        totalIncome,
        netPay
      });

      return {
        regular_hours: regularHours,
        regular_hours_paid: regularHoursPaid,
        overtime_hours: overtimeHours,
        stat_holiday_hours: statHolidayHours,
        total_hours: totalWorkedHours,
        lieu_earned: lieuEarned,
        lieu_used: lieuUsed,
        lieu_balance_before: currentLieuBalance,
        lieu_balance_after: lieuBalanceAfter,
        lieu_balance: lieuBalanceAfter,
        regular_pay: regularPay,
        overtime_pay: overtimePay,
		lieu_pay: lieuPay, 
        stat_holiday_pay: statHolidayPay,
        premium_pay: premiumPay,
        gross_pay: grossPay,
        vacation_pay: vacationPay,
        vacation_percent_display: vacationPercentDisplay,
        holiday_pay: holidayPayAmount,
        total_income: totalIncome,
        federal_tax: baseFederalTax,
        total_federal_tax: totalFederalTax,
        additional_federal_tax: additionalTax,
        provincial_tax: baseProvincialTax,
        ontario_health_premium: ohp,
        provincial_tax_total: totalProvincialTax,
        ei_premium: eiPremium,
        ei_deduction: eiPremium,
        cpp_contribution: cppContribution,             // base + first additional + CPP2 (combined for paycheque deduction)
        cpp_base_contribution: cppBaseContribution,    // base + first additional only
        cpp2_contribution: cpp2Contribution,           // second additional (T4 box 16A)
        cpp_deduction: cppContribution,                // legacy field name; mirrors cpp_contribution for DB compatibility
        total_deductions: totalDeductions,
        net_pay: netPay,
        wage_breakdown: wageBreakdown,
        has_wage_changes: hasWageChange,
        calculation_method: hasWageChange ? 'cra_compliant_with_wage_splits' : 'cra_compliant_with_ohp',
        pay_periods: payPeriods,
        claim_code: claimCode,
        jurisdiction,
        hourly_rate: wage,
        cra_compliance: craCalculation.cra_compliance || { is_cra_compliant: true },
        rates_used: craCalculation.rates_used || {}
      };

    } catch (error) {
      console.error('Error calculating tax preview:', error);
      return {
        gross_pay: 0,
        vacation_pay: 0,
        federal_tax: 0,
        provincial_tax_total: 0,
        ontario_health_premium: 0,
        ei_premium: 0,
        cpp_contribution: 0,
        total_deductions: 0,
        net_pay: 0,
        calculation_method: 'error',
        error: error.message
      };
    }
  }, [
    employee, 
    localHours, 
    localAdditionalFedTax, 
    localHolidayPay, 
    holidayPayEnabled, 
    missedShiftBefore, 
    missedShiftAfter,
    allPremiums,
    isEmployeePremiumEnabled,
    getEmployeePremiumRate,
    getEmployeePremiumRateType,
    settings,
    canadianTax,
    ontarioHealthPremium,
    hasWageChange,
    payPeriod
  ]);

  const handleSave = async () => {
    try {
      await recordAction('employee_modal_save', employee?.id);
      
      if (onHolidayPayChange && employee?.id) {
        const holidayDetails = holidayPayEnabled ? {
          holidayDate,
          holidayName: localHolidayDetails?.holidayName || 'Holiday',
          missedShiftBefore,
          missedShiftAfter,
          calculationMethod: localHolidayDetails?.calculationMethod || 'Manual',
          jurisdiction: settings?.tax_jurisdiction || 'ON',
          isEligible: !missedShiftBefore && !missedShiftAfter
        } : null;
        
        const finalHolidayPay = (holidayPayEnabled && !missedShiftBefore && !missedShiftAfter) ? localHolidayPay : 0;
        
        await onHolidayPayChange(employee.id, finalHolidayPay, holidayDetails);
      }
      
      onSave(employee.id, localHours, localAdditionalFedTax, 0, calculatedPreview);
      onClose();
      
    } catch (error) {
      console.error('Error saving employee modal data:', error);
    }
  };

  const updateHours = (field, value, premiumName = null) => {
    const sanitized = parseFloat(value) || 0;
    if (field === 'lieu_earned' || field === 'lieu_used') {
      lieuManuallyEditedRef.current = true;
    } else if (
      field === 'total_hours' ||
      field === 'overtime_hours' ||
      field === 'stat_worked_hours'
    ) {
      lieuManuallyEditedRef.current = false;
    }
    if (premiumName) {
      setLocalHours(prev => ({
        ...prev,
        premium_hours: {
          ...prev.premium_hours,
          [premiumName]: sanitized
        }
      }));
    } else if (field === 'lieu_earned' || field === 'lieu_used') {
      setLocalHours((prev) => {
        const earned =
          field === 'lieu_earned' ? sanitized : parseFloat(prev.lieu_earned || 0);
        const used = field === 'lieu_used' ? sanitized : parseFloat(prev.lieu_used || 0);
        const clamped = clampLieuHoursForPeriod({ employee, lieuEarned: earned, lieuUsed: used });
        return {
          ...prev,
          lieu_earned: clamped.lieuEarned,
          lieu_used: clamped.lieuUsed,
          lieu_balance: clamped.lieuBalanceAfter
        };
      });
    } else {
      setLocalHours(prev => ({
        ...prev,
        [field]: sanitized
      }));
    }
  };

  const handleHolidayPayToggle = (checked) => {
    setHolidayPayEnabled(checked);
    if (!checked) {
      setHolidayDate('');
      setMissedShiftBefore(false);
      setMissedShiftAfter(false);
      setLocalHolidayPay(0);
      setLocalHolidayDetails(null);
    }
  };

  const handleHolidayPayCalculation = (holidayPayAmount, holidayDetails) => {
    console.log('🎉 Holiday pay callback triggered:', holidayPayAmount, holidayDetails);
    setLocalHolidayPay(holidayPayAmount || 0);
    setLocalHolidayDetails(holidayDetails);
  };
  
  const handlePremiumHoursChange = useCallback((updatedPremiumHours) => {
    setLocalHours(prev => ({
      ...prev,
      premium_hours: updatedPremiumHours
    }));
  }, []);
  
  const isHolidayPayEligible = useMemo(() => {
    return holidayPayEnabled && holidayDate && !missedShiftBefore && !missedShiftAfter;
  }, [holidayPayEnabled, holidayDate, missedShiftBefore, missedShiftAfter]);

  const lieuCapSummary = useMemo(() => {
    if (!employee?.lieu_time_enabled) return null;
    const maxHours = parseFloat(employee.max_paid_hours_per_period) || 0;
    if (maxHours <= 0) return null;

    const worked = parseFloat(localHours.total_hours) || 0;
    const holidayPayAmount =
      holidayPayEnabled && !missedShiftBefore && !missedShiftAfter ? localHolidayPay : 0;
    const auto = computeAutoLieuForPeriod({
      employee,
      totalWorkedHours: worked,
      statHolidayHours: localHours.stat_worked_hours,
      holidayPayAmount,
    });

    if (auto.lieuEarned <= 0) return null;
    return {
      maxHours,
      worked,
      lieuEarned: auto.lieuEarned,
    };
  }, [
    employee,
    localHours.total_hours,
    localHours.stat_worked_hours,
    holidayPayEnabled,
    localHolidayPay,
    missedShiftBefore,
    missedShiftAfter,
  ]);
  
  // Auto-fill lieu earned/used when worked hours or holiday pay change (not after manual lieu edits).
  useEffect(() => {
    if (!isOpen || !employee?.lieu_time_enabled || lieuManuallyEditedRef.current) return;

    const holidayPayAmount =
      holidayPayEnabled && !missedShiftBefore && !missedShiftAfter ? localHolidayPay : 0;
    const autoLieu = computeAutoLieuForPeriod({
      employee,
      totalWorkedHours: localHours.total_hours,
      statHolidayHours: localHours.stat_worked_hours,
      holidayPayAmount,
    });

    setLocalHours((prev) => ({
      ...prev,
      lieu_earned: autoLieu.lieuEarned,
      lieu_used: autoLieu.lieuUsed,
      lieu_balance: autoLieu.lieuBalanceAfter
    }));
  }, [
    isOpen,
    employee?.id,
    employee?.lieu_time_enabled,
    employee?.lieu_time_balance,
    employee?.max_paid_hours_per_period,
    localHours.total_hours,
    localHours.stat_worked_hours,
    localHolidayPay,
    holidayPayEnabled,
    missedShiftBefore,
    missedShiftAfter
  ]);

  const maxLieuUsableThisPeriod = useMemo(() => {
    if (!employee?.lieu_time_enabled) return 0;
    const clamped = clampLieuHoursForPeriod({
      employee,
      lieuEarned: localHours.lieu_earned,
      lieuUsed: localHours.lieu_used
    });
    return clamped.lieuBalanceBefore + clamped.lieuEarned;
  }, [
    employee,
    localHours.lieu_earned,
    localHours.lieu_used
  ]);
  
  if (!isOpen || !employee) return null;
  
  return (
    <SecurityWrapper>
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.header}>
            <h3 style={styles.title}>
              Payroll Entry: {employee.first_name} {employee.last_name}
            </h3>
            <button onClick={handleClose} style={styles.closeButton}>×</button>
          </div>

          <div style={styles.body}>
            
            <div style={styles.section}>
              <h4 style={styles.sectionTitle}>Basic Hours</h4>
              <div style={styles.gridThreeCol}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>
                    Total Hours Worked
                    {hasWageChange && <span style={{color: '#f59e0b', marginLeft: '8px', fontWeight: '700'}}>⚠️ Wage Changed</span>}
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    max="168"
                    style={{
                      ...styles.input,
                      ...(hasWageChange ? {borderColor: '#f59e0b', borderWidth: '2px'} : {})
                    }}
                    value={localHours.total_hours || ''}
                    onChange={(e) => updateHours('total_hours', e.target.value)}
                    placeholder="0.00"
                    onFocus={(e) => e.target.select()}
                    onClick={(e) => e.target.select()}
                  />
                  {lieuCapSummary && (
                    <div style={{ ...styles.infoText, color: '#b45309', marginTop: '6px' }}>
                      Max paid hours this period: {lieuCapSummary.maxHours.toFixed(2)}.
                      {` ${lieuCapSummary.worked.toFixed(2)} worked → ${lieuCapSummary.lieuEarned.toFixed(2)} banked as lieu time (not paid in cash).`}
                    </div>
                  )}
                  {hasWageChange && (
                    <div style={{marginTop: '8px'}}>
                      <button
                        onClick={() => setShowWagePeriodModal(true)}
                        style={styles.secondaryButton}
                      >
                        Split Hours by Wage Period
                      </button>
                    </div>
                  )}
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Overtime Hours</label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    style={styles.input}
                    value={localHours.overtime_hours || ''}
                    onChange={(e) => updateHours('overtime_hours', e.target.value)}
                    placeholder="0.00"
                    onFocus={(e) => e.target.select()}
                    onClick={(e) => e.target.select()}
                  />
                  <div style={styles.infoText}>
                    Paid at 1.5x regular rate
                  </div>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Stat Holiday Hours Worked</label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    style={styles.input}
                    value={localHours.stat_worked_hours || ''}
                    onChange={(e) => updateHours('stat_worked_hours', e.target.value)}
                    placeholder="0.00"
                    onFocus={(e) => e.target.select()}
                    onClick={(e) => e.target.select()}
                  />
                  <div style={styles.infoText}>
                    Auto-filled from timesheets when hours were worked on a stat holiday (e.g. Canada Day). Paid at 1.5× regular rate — not included in Total Hours Worked above.
                  </div>
                </div>
              </div>
              <div style={styles.statHolidayGuide}>
                <strong>Worked on a stat holiday (e.g. Canada Day)?</strong>
                <ol style={styles.statHolidayGuideList}>
                  <li>Enter stat holiday hours here (1.5× premium pay).</li>
                  <li>Enable <em>Include Holiday Pay</em> below for the ESA public holiday amount (average day&apos;s pay).</li>
                  <li>Confirm the employee worked their last shift before and first shift after the holiday.</li>
                </ol>
              </div>
            </div>

            <div style={employee?.lieu_time_enabled ? styles.section : styles.sectionDisabled}>
              <h4 style={employee?.lieu_time_enabled ? styles.sectionTitle : styles.sectionTitleDisabled}>
                Lieu Time (Time in Lieu)
                {!employee?.lieu_time_enabled && ' - Disabled for this employee'}
              </h4>
              <div style={styles.gridThreeCol}>
                <div style={styles.formGroup}>
                  <label style={employee?.lieu_time_enabled ? styles.label : styles.labelDisabled}>
                    Lieu Time Earned
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    style={{
                      ...styles.input,
                      ...(employee?.lieu_time_enabled ? {} : styles.inputDisabled)
                    }}
                    value={employee?.lieu_time_enabled ? (parseFloat(localHours.lieu_earned || 0).toFixed(2)) : '0.00'}
                    onChange={(e) => employee?.lieu_time_enabled && updateHours('lieu_earned', e.target.value)}
                    placeholder="0.00"
                    disabled={!employee?.lieu_time_enabled}
                    onFocus={(e) => e.target.select()}
                    onClick={(e) => e.target.select()}
                  />
                  <div style={styles.infoText}>
                    Lieu time earned this period
                  </div>
                </div>
                <div style={styles.formGroup}>
                  <label style={employee?.lieu_time_enabled ? styles.label : styles.labelDisabled}>
                    Lieu Time Used
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    max={maxLieuUsableThisPeriod > 0 ? maxLieuUsableThisPeriod : undefined}
                    style={{
                      ...styles.input,
                      ...(employee?.lieu_time_enabled ? {} : styles.inputDisabled)
                    }}
                    value={employee?.lieu_time_enabled ? (parseFloat(localHours.lieu_used || 0).toFixed(2)) : '0.00'}
                    onChange={(e) => employee?.lieu_time_enabled && updateHours('lieu_used', e.target.value)}
                    placeholder="0.00"
                    disabled={!employee?.lieu_time_enabled}
                    onFocus={(e) => e.target.select()}
                    onClick={(e) => e.target.select()}
                  />
                  <div style={styles.infoText}>
                    Lieu time taken this period
                    {employee?.lieu_time_enabled && maxLieuUsableThisPeriod <= 0 ? (
                      <span style={{ display: 'block', color: '#b45309', marginTop: '4px' }}>
                        No lieu balance available — cannot use lieu until time is earned.
                      </span>
                    ) : null}
                  </div>
                </div>
                <div style={styles.formGroup}>
                  <label style={employee?.lieu_time_enabled ? styles.label : styles.labelDisabled}>
                    Lieu Balance After
                  </label>
                  <input
                    type="number"
                    style={{
                      ...styles.input,
                      ...(employee?.lieu_time_enabled ? {} : styles.inputDisabled),
                      backgroundColor: '#f9fafb'
                    }}
                    value={employee?.lieu_time_enabled ? (calculatedPreview.lieu_balance || 0).toFixed(2) : '0.00'}
                    disabled
                    readOnly
                  />
                  <div style={styles.infoText}>
                    New lieu time balance (auto-calculated)
                  </div>
                </div>
              </div>
            </div>

            <PETPremiumHoursSection
              allPremiums={allPremiums}
              localHours={localHours}
              onPremiumHoursChange={handlePremiumHoursChange}
              saving={false}
              employee={employee}
              isEmployeePremiumEnabled={isEmployeePremiumEnabled}
              regularHoursPaid={calculatedPreview?.regular_hours_paid}
              overtimeHours={calculatedPreview?.overtime_hours}
              statHolidayHours={calculatedPreview?.stat_holiday_hours}
              lieuEarned={calculatedPreview?.lieu_earned}
            />

            <div style={styles.section}>
              <div style={styles.checkboxRow}>
                <TavariCheckbox
                  id={`holiday-pay-${employee.id}`}
                  checked={holidayPayEnabled}
                  onChange={handleHolidayPayToggle}
                  label="Include Holiday Pay for this Period"
                  color={TavariStyles.colors.primary}
                />
              </div>

              {holidayPayEnabled && (
                <div style={styles.holidayPaySection}>
                  <HolidayPayCalculator
                    employee={employee}
                    selectedBusinessId={selectedBusinessId}
                    settings={settings}
                    initialHolidayDate={holidayDate}
                    payPeriod={payPeriod}
                    onHolidayPayChange={handleHolidayPayCalculation}
                    formatAmount={formatTaxAmount}
                    missedShiftBefore={missedShiftBefore}
                    missedShiftAfter={missedShiftAfter}
                  />

                  <div style={styles.complianceSection}>
                    <h5 style={styles.complianceTitle}>ESA Holiday Pay Eligibility</h5>
                    <div style={styles.checkboxGrid}>
                      <TavariCheckbox
                        id={`missed-before-${employee.id}`}
                        checked={missedShiftBefore}
                        onChange={(checked) => setMissedShiftBefore(checked)}
                        label="Missed scheduled shift before holiday"
                        color={TavariStyles.colors.danger}
                      />
                      <TavariCheckbox
                        id={`missed-after-${employee.id}`}
                        checked={missedShiftAfter}
                        onChange={(checked) => setMissedShiftAfter(checked)}
                        label="Missed scheduled shift after holiday"
                        color={TavariStyles.colors.danger}
                      />
                    </div>
                    
                    {(missedShiftBefore || missedShiftAfter) && (
                      <div style={styles.warningBox}>
                        <strong>Warning:</strong> Employee may not qualify for holiday pay due to missed shifts before/after the holiday.
                      </div>
                    )}
                    
                    {isHolidayPayEligible && (
                      <div style={styles.successBox}>
                        <strong>Success:</strong> Employee qualifies for holiday pay of ${localHolidayPay.toFixed(2)}.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div style={styles.section}>
              <h4 style={styles.sectionTitle}>Tax Adjustments</h4>
              <div style={styles.formGroup}>
                <label style={styles.label}>Additional Federal Tax</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  style={styles.input}
                  value={localAdditionalFedTax || ''}
                  onChange={(e) => setLocalAdditionalFedTax(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  onFocus={(e) => e.target.select()}
                  onClick={(e) => e.target.select()}
                />
                <div style={styles.infoText}>
                  Extra federal tax to withhold (beyond normal calculation)
                </div>
              </div>
            </div>

            <div style={styles.section}>
              <h4 style={styles.sectionTitle}>CRA-Compliant Pay Preview</h4>
              <div style={styles.previewBox}>
                {calculatedPreview.calculation_method === 'error' ? (
                  <div style={styles.previewError}>
                    <strong>Calculation Error:</strong> {calculatedPreview.error}
                  </div>
                ) : calculatedPreview.calculation_method === 'hooks_not_ready' ? (
                  <div style={styles.previewLoading}>
                    Loading calculation engine...
                  </div>
                ) : (
                  <div style={styles.previewGrid}>
                    <div style={styles.previewSection}>
                      <h5 style={styles.previewSectionTitle}>Hours & Earnings</h5>
                      <div style={styles.previewItem}>
                        <span>Regular Hours:</span>
                        <strong>{calculatedPreview.regular_hours?.toFixed(2) || '0.00'} hrs</strong>
                      </div>
                      <div style={styles.previewItem}>
                        <span>Overtime Hours:</span>
                        <strong>{calculatedPreview.overtime_hours?.toFixed(2) || '0.00'} hrs</strong>
                      </div>
                      <div style={styles.previewItem}>
                        <span>Stat Worked Hours:</span>
                        <strong>{calculatedPreview.stat_holiday_hours?.toFixed(2) || '0.00'} hrs</strong>
                      </div>
                      <div style={styles.previewItem}>
                        <span>Regular Pay:</span>
                        <strong>${formatTaxAmount(calculatedPreview.regular_pay)}</strong>
                      </div>
                      <div style={styles.previewItem}>
                        <span>Overtime Pay:</span>
                        <strong>${formatTaxAmount(calculatedPreview.overtime_pay)}</strong>
                      </div>
                      {calculatedPreview.lieu_used > 0 && (
                        <div style={styles.previewItem}>
                          <span>Lieu Pay:</span>
                          <strong>${formatTaxAmount(calculatedPreview.lieu_pay)} ({calculatedPreview.lieu_used.toFixed(2)} hrs)</strong>
                        </div>
                      )}
                      {calculatedPreview.stat_holiday_pay > 0 && (
                        <div style={styles.previewItem}>
                          <span>Stat Holiday Pay:</span>
                          <strong>${formatTaxAmount(calculatedPreview.stat_holiday_pay)}</strong>
                        </div>
                      )}
                      {calculatedPreview.premium_pay > 0 && (
                        <div style={styles.previewItem}>
                          <span>Premium Pay:</span>
                          <strong>${formatTaxAmount(calculatedPreview.premium_pay)}</strong>
                        </div>
                      )}
                      <div style={{...styles.previewItem, ...styles.previewTotal}}>
                        <span>Gross Pay:</span>
                        <strong>${formatTaxAmount(calculatedPreview.gross_pay)}</strong>
                      </div>
                      <div style={styles.previewItem}>
                        <span>Vacation Pay ({calculatedPreview.vacation_percent_display}%):</span>
                        <strong>+${formatTaxAmount(calculatedPreview.vacation_pay)}</strong>
                      </div>
                      {calculatedPreview.holiday_pay > 0 && (
                        <div style={styles.previewItem}>
                          <span>Holiday Pay:</span>
                          <strong>+${formatTaxAmount(calculatedPreview.holiday_pay)}</strong>
                        </div>
                      )}
                      <div style={{...styles.previewItem, ...styles.previewTotal}}>
                        <span>Total Income:</span>
                        <strong>${formatTaxAmount(calculatedPreview.total_income)}</strong>
                      </div>
                    </div>

                    <div style={styles.previewSection}>
                      <h5 style={styles.previewSectionTitle}>Tax Deductions</h5>
                      <div style={styles.previewItem}>
                        <span>Federal Tax:</span>
                        <strong>${formatTaxAmount(calculatedPreview.federal_tax)}</strong>
                      </div>
                      {calculatedPreview.additional_federal_tax > 0 && (
                        <div style={styles.previewItem}>
                          <span>Additional Fed Tax:</span>
                          <strong>${formatTaxAmount(calculatedPreview.additional_federal_tax)}</strong>
                        </div>
                      )}
                      <div style={styles.previewItem}>
                        <span>Provincial Tax:</span>
                        <strong>${formatTaxAmount(calculatedPreview.provincial_tax)}</strong>
                        {calculatedPreview.ontario_health_premium > 0 && (
                          <span style={{fontSize: '18px', color: '#6b7280', marginLeft: '8px', fontStyle: 'italic'}}>
                            (includes OHP: ${formatTaxAmount(calculatedPreview.ontario_health_premium)})
                          </span>
                        )}
                      </div>
                      <div style={styles.previewItem}>
                        <span>EI Premium:</span>
                        <strong>${formatTaxAmount(calculatedPreview.ei_premium)}</strong>
                      </div>
                      <div style={styles.previewItem}>
                        <span>CPP Contribution:</span>
                        <strong>${formatTaxAmount(calculatedPreview.cpp_contribution)}</strong>
                      </div>
                      <div style={{...styles.previewItem, ...styles.previewTotal}}>
                        <span>Total Deductions:</span>
                        <strong>${formatTaxAmount(calculatedPreview.total_deductions)}</strong>
                      </div>
                    </div>

                    <div style={styles.previewSection}>
                      <h5 style={styles.previewSectionTitle}>Lieu Time & Net Pay</h5>
                      {employee?.lieu_time_enabled && (
                        <>
                          <div style={styles.previewItem}>
                            <span>Lieu Earned:</span>
                            <strong>{calculatedPreview.lieu_earned?.toFixed(2) || '0.00'} hrs</strong>
                          </div>
                          <div style={styles.previewItem}>
                            <span>Lieu Used:</span>
                            <strong>{calculatedPreview.lieu_used?.toFixed(2) || '0.00'} hrs</strong>
                          </div>
                          <div style={styles.previewItem}>
                            <span>Lieu Balance Before:</span>
                            <strong>{calculatedPreview.lieu_balance_before?.toFixed(2) || '0.00'} hrs</strong>
                          </div>
                          <div style={{...styles.previewItem, ...styles.previewTotal}}>
                            <span>Lieu Balance After:</span>
                            <strong>{calculatedPreview.lieu_balance_after?.toFixed(2) || '0.00'} hrs</strong>
                          </div>
                        </>
                      )}
                      <div style={{...styles.previewItem, ...styles.previewFinal}}>
                        <span><strong>NET PAY:</strong></span>
                        <strong>${formatTaxAmount(calculatedPreview.net_pay)}</strong>
                      </div>
                    </div>

                    <div style={styles.previewNote}>
                      <small>
                        <strong>CRA-Compliant Calculation</strong>
                        <br/>
                        <em>
                        Federal & Provincial tax calculated using {calculatedPreview.cra_compliance?.tax_year || canadianTax?.taxSettings?.tax_year || new Date().getFullYear()} CRA withholding tables (Claim Code {calculatedPreview.claim_code || 1}).
                        {calculatedPreview.ontario_health_premium > 0 && ' Includes Ontario Health Premium calculation.'}
                        {calculatedPreview.has_wage_changes && ' Pay calculated using multiple wage rates for accuracy.'}
                        Vacation pay calculated at {calculatedPreview.vacation_percent_display}% per employee/business settings.
                        </em>
                      </small>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={styles.footer}>
            <button onClick={handleClose} style={styles.cancelButton}>
              Cancel
            </button>
            <button onClick={handleSave} style={styles.saveButton}>
              Save Entry
            </button>
          </div>
        </div>
      </div>

      <WagePeriodHoursModal
        isOpen={showWagePeriodModal}
        onClose={() => setShowWagePeriodModal(false)}
        employee={employee}
        wagePeriods={wagePeriods}
        initialHours={localHours}
        onSave={(totals) => {
          setLocalHours(prev => ({
            ...prev,
            ...totals
          }));
          setShowWagePeriodModal(false);
        }}
      />
    </SecurityWrapper>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  },
  modal: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    width: '90%',
    maxWidth: '1200px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 25px 50px rgba(0,0,0,0.2)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '2px solid #e5e7eb',
    backgroundColor: '#f9fafb'
  },
  title: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#1f2937',
    margin: 0
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '16px',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '8px',
    borderRadius: '6px'
  },
  body: {
    flex: 1,
    padding: '24px',
    overflowY: 'auto',
    maxHeight: 'calc(90vh - 140px)'
  },
  section: {
    marginBottom: '32px',
    padding: '20px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px'
  },
  sectionDisabled: {
    marginBottom: '32px',
    padding: '20px',
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    opacity: 0.6
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '16px',
    margin: 0,
    paddingBottom: '8px',
    borderBottom: '2px solid #008080'
  },
  sectionTitleDisabled: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#9ca3af',
    marginBottom: '16px',
    margin: 0,
    paddingBottom: '8px',
    borderBottom: '2px solid #e5e7eb'
  },
  gridTwoCol: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '20px'
  },
  gridThreeCol: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '20px'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column'
  },
  label: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '8px'
  },
  labelDisabled: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#9ca3af',
    marginBottom: '8px'
  },
  input: {
    padding: '12px 16px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '12px',
    fontFamily: 'inherit',
    backgroundColor: '#ffffff',
    transition: 'border-color 0.2s'
  },
  inputDisabled: {
    backgroundColor: '#f9fafb',
    color: '#9ca3af',
    cursor: 'not-allowed'
  },
  infoText: {
    fontSize: '14px',
    color: '#6b7280',
    marginTop: '4px',
    fontStyle: 'italic'
  },
  statHolidayGuide: {
    marginTop: '12px',
    padding: '12px 14px',
    backgroundColor: '#eff6ff',
    border: '1px solid #93c5fd',
    borderRadius: '6px',
    fontSize: '14px',
    color: '#1e3a5f',
    lineHeight: 1.5
  },
  statHolidayGuideList: {
    margin: '8px 0 0',
    paddingLeft: '20px'
  },
  checkboxRow: {
    marginBottom: '16px'
  },
  holidayPaySection: {
    marginTop: '16px'
  },
  complianceSection: {
    marginTop: '16px',
    padding: '16px',
    backgroundColor: '#fefce8',
    border: '1px solid #facc15',
    borderRadius: '6px'
  },
  complianceTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '12px',
    margin: 0
  },
  checkboxGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    marginBottom: '12px'
  },
  warningBox: {
    padding: '12px',
    backgroundColor: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: '6px',
    color: '#dc2626',
    fontSize: '13px'
  },
  successBox: {
    padding: '12px',
    backgroundColor: '#f0f9ff',
    border: '1px solid #93c5fd',
    borderRadius: '6px',
    color: '#1d4ed8',
    fontSize: '14px'
  },
  secondaryButton: {
    padding: '8px 16px',
    backgroundColor: '#ffffff',
    border: '1px solid #d1d5db',
    color: '#374151',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  previewBox: {
    padding: '20px',
    backgroundColor: '#f9fafb',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '13px'
  },
  previewGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '24px'
  },
  previewSection: {
    padding: '16px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '6px'
  },
  previewSectionTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '12px',
    margin: 0,
    paddingBottom: '8px',
    borderBottom: '1px solid #e5e7eb'
  },
  previewItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    fontSize: '14px',
    color: '#4b5563'
  },
  previewTotal: {
    borderTop: '1px solid #e5e7eb',
    marginTop: '8px',
    paddingTop: '8px',
    color: '#1f2937'
  },
  previewFinal: {
    borderTop: '2px solid #008080',
    marginTop: '12px',
    paddingTop: '12px',
    color: '#008080',
    fontSize: '14px'
  },
  previewError: {
    padding: '20px',
    backgroundColor: '#fee2e2',
    border: '1px solid #fca5a5',
    borderRadius: '6px',
    color: '#dc2626',
    fontSize: '14px',
    textAlign: 'center'
  },
  previewLoading: {
    padding: '20px',
    backgroundColor: '#f0f9ff',
    border: '1px solid #bfdbfe',
    borderRadius: '6px',
    color: '#1e40af',
    fontSize: '14px',
    textAlign: 'center'
  },
  previewNote: {
    gridColumn: '1 / -1',
    marginTop: '16px',
    padding: '16px',
    backgroundColor: '#f0f9ff',
    border: '2px solid #0ea5e9',
    borderRadius: '6px',
    textAlign: 'center',
    color: '#1e40af'
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '20px 24px',
    borderBottom: '2px solid #e5e7eb',
    backgroundColor: '#f9fafb'
  },
  cancelButton: {
    padding: '12px 24px',
    backgroundColor: '#ffffff',
    border: '1px solid #d1d5db',
    color: '#374151',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  saveButton: {
    padding: '12px 24px',
    backgroundColor: '#008080',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  }
};

export default PETEmployeeEntryModal;