// components/HR/HRPayrollComponents/PET-EmployeeEntryModal.jsx - COMPLETE REWRITE WITH WORKING HOLIDAY PAY
import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
      setLocalHours(hours);
    }
  }, [isOpen, hours]);

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

  useEffect(() => {
    if (!isOpen || !employee || !getEmployeePreview) return;

    const calculateLieu = async () => {
      try {
        const tempHours = { ...localHours, holiday_pay: localHolidayPay };
        const preview = await getEmployeePreview(employee.id, tempHours, localAdditionalFedTax, 0);
        
        if (preview) {
          setLocalHours(prev => ({
            ...prev,
            lieu_earned: preview.lieu_earned || 0,
            lieu_used: preview.lieu_used || 0,
            lieu_balance: preview.lieu_balance_after || prev.lieu_balance || 0
          }));
        }
      } catch (error) {
        console.error('Lieu calc error:', error);
      }
    };

    const timer = setTimeout(calculateLieu, 300);
    return () => clearTimeout(timer);
  }, [localHours.total_hours, localHours.overtime_hours, localHours.stat_worked_hours, localHolidayPay, employee?.id, isOpen, getEmployeePreview]);

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
      const currentLieuBalance = parseFloat(employee.lieu_time_balance || 0);
      const holidayPayHours = localHolidayPay > 0 && wage > 0 ? (localHolidayPay / wage) : 0;
      
      let lieuEarned = 0;
      let lieuUsed = 0;
      let lieuBalanceAfter = currentLieuBalance;
      
      if (employee?.lieu_time_enabled) {
        const maxHours = parseFloat(employee.max_paid_hours_per_period || 0);
        const totalCompensationHours = totalWorkedHours + statHolidayHours + holidayPayHours;
        
        if (maxHours > 0) {
          if (totalCompensationHours > maxHours) {
            lieuEarned = totalCompensationHours - maxHours;
            lieuBalanceAfter = currentLieuBalance + lieuEarned;
          } else {
            const shortfall = maxHours - totalCompensationHours;
            lieuUsed = Math.min(shortfall, currentLieuBalance);
            lieuBalanceAfter = currentLieuBalance - lieuUsed;
          }
        }
      }

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
      
      // FIXED: Get vacation_percent directly from database to bypass cached data
      let vacationPercent = parseFloat(employee.vacation_percent || settings?.default_vacation_percent || 0.04);
      
      // If vacation_percent looks like a percentage (>= 1.0), convert it to decimal
      if (vacationPercent >= 1.0) {
        console.log('🔄 FIXING: Converting vacation_percent from percentage to decimal:', vacationPercent, '->', vacationPercent / 100);
        vacationPercent = vacationPercent / 100;
      }
      
      const vacationPay = grossPay * vacationPercent;
      const vacationPercentDisplay = (vacationPercent * 100).toFixed(2);  // For display as percentage
      
      const holidayPayAmount = (holidayPayEnabled && !missedShiftBefore && !missedShiftAfter) ? localHolidayPay : 0;
      
      const totalIncome = grossPay + vacationPay + holidayPayAmount;

      const claimCode = parseInt(employee.claim_code || 1);
      const jurisdiction = settings?.tax_jurisdiction || 'ON';
      const payFrequency = settings?.pay_frequency || 'bi_weekly';
      const payPeriods = payFrequency === 'weekly' ? 52 : payFrequency === 'bi_weekly' ? 26 : payFrequency === 'monthly' ? 12 : 24;

      const craCalculation = canadianTax.calculateCRACompliantTaxes({
        grossPay: totalIncome,
        payPeriods: payPeriods,
        claimCode: claimCode,
        jurisdiction: jurisdiction,
        yearToDateTotals: {
          yearToDateGross: 0,
          yearToDateEI: 0,
          yearToDateCPP: 0
        }
      });

      const baseFederalTax = craCalculation.federal_tax_period || 0;
      const additionalTax = parseFloat(localAdditionalFedTax) || 0;
      const totalFederalTax = baseFederalTax + additionalTax;

      const baseProvincialTax = craCalculation.provincial_tax_period || 0;
      let ohp = 0;
      
      if (jurisdiction === 'ON' && ontarioHealthPremium && typeof ontarioHealthPremium === 'function') {
        const annualIncome = totalIncome * payPeriods;
        ohp = ontarioHealthPremium(annualIncome, payPeriods);
      }

      const totalProvincialTax = baseProvincialTax + ohp;
      const eiPremium = craCalculation.ei_premium || 0;
      const cppContribution = craCalculation.cpp_contribution || 0;

      const totalDeductions = totalFederalTax + totalProvincialTax + eiPremium + cppContribution;
      const netPay = Math.max(0, totalIncome - totalDeductions);

      const newLieuBalance = currentLieuBalance + lieuEarned - lieuUsed;

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
        cpp_contribution: cppContribution,
        cpp_deduction: cppContribution,
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
    if (premiumName) {
      setLocalHours(prev => ({
        ...prev,
        premium_hours: {
          ...prev.premium_hours,
          [premiumName]: sanitized
        }
      }));
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
  
  useEffect(() => {
    if (calculatedPreview && employee?.lieu_time_enabled) {
      setLocalHours(prev => ({
        ...prev,
        lieu_earned: calculatedPreview.lieu_earned || 0,
        lieu_used: calculatedPreview.lieu_used || 0
      }));
    }
  }, [calculatedPreview.lieu_earned, calculatedPreview.lieu_used, employee?.lieu_time_enabled]);
  
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
                    step="0.25"f
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
                    Paid at 1.5x regular rate
                  </div>
                </div>
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
                    selectedHolidayDate={holidayDate}
                    payPeriod={payPeriod}
                    onHolidayPayChange={handleHolidayPayCalculation}
                    formatAmount={formatTaxAmount}
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
                      </div>
                      {calculatedPreview.ontario_health_premium > 0 && (
                        <div style={styles.previewItem}>
                          <span>Ontario Health Premium:</span>
                          <strong>${formatTaxAmount(calculatedPreview.ontario_health_premium)}</strong>
                        </div>
                      )}
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
                        Federal & Provincial tax calculated using {new Date().getFullYear()} CRA withholding tables (Claim Code {calculatedPreview.claim_code || 1}).
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
    fontSize: '18px',
    fontWeight: '700',
    color: '#1f2937',
    margin: 0
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
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
    fontSize: '16px',
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
    fontSize: '14px',
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
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '4px',
    fontStyle: 'italic'
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
    fontSize: '14px'
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
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  previewBox: {
    padding: '20px',
    backgroundColor: '#f9fafb',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '14px'
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
    fontSize: '13px',
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
    fontSize: '14px',
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
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  }
};

export default PETEmployeeEntryModal;