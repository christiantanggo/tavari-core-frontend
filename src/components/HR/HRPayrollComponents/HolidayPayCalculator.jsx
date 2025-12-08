// components/HR/HRPayrollComponents/HolidayPayCalculator.jsx - CORRECTED: Uses pay_period_end, proper period counting, and ESA-compliant calculation
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../../supabaseClient';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';

const HolidayPayCalculator = ({
  employee,
  selectedBusinessId,
  onHolidayPayChange,
  payPeriod,
  settings,
  formatAmount,
  missedShiftBefore,
  missedShiftAfter
}) => {
  const [selectedHolidayDate, setSelectedHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');
  const [holidayPayAmount, setHolidayPayAmount] = useState(0);
  const [isEligible, setIsEligible] = useState(true);
  const [eligibilityReason, setEligibilityReason] = useState('');
  const [calculationDetails, setCalculationDetails] = useState({});
  const [loading, setLoading] = useState(false);
  const [payrollHistory, setPayrollHistory] = useState([]);

  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'HolidayPayCalculator',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  const {
    selectedBusinessId: authBusinessId,
    authUser,
    userRole,
    businessData
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'hr_admin'],
    requireBusiness: true,
    componentName: 'HolidayPayCalculator'
  });

  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId || authBusinessId);

  const CANADIAN_HOLIDAYS = {
    federal: [
      { name: 'New Year\'s Day', date: '2025-01-01' },
      { name: 'Good Friday', date: '2025-04-18' },
      { name: 'Easter Monday', date: '2025-04-21' },
      { name: 'Victoria Day', date: '2025-05-19' },
      { name: 'Canada Day', date: '2025-07-01' },
      { name: 'Labour Day', date: '2025-09-01' },
      { name: 'Thanksgiving Day', date: '2025-10-13' },
      { name: 'Remembrance Day', date: '2025-11-11' },
      { name: 'Christmas Day', date: '2025-12-25' },
      { name: 'Boxing Day', date: '2025-12-26' }
    ],
    ontario: [
      { name: 'New Year\'s Day', date: '2025-01-01' },
      { name: 'Family Day', date: '2025-02-17' },
      { name: 'Good Friday', date: '2025-04-18' },
      { name: 'Victoria Day', date: '2025-05-19' },
      { name: 'Canada Day', date: '2025-07-01' },
      { name: 'Civic Holiday', date: '2025-08-04' },
      { name: 'Labour Day', date: '2025-09-01' },
      { name: 'Thanksgiving Day', date: '2025-10-13' },
      { name: 'Christmas Day', date: '2025-12-25' },
      { name: 'Boxing Day', date: '2025-12-26' }
    ],
    bc: [
      { name: 'New Year\'s Day', date: '2025-01-01' },
      { name: 'Family Day', date: '2025-02-17' },
      { name: 'Good Friday', date: '2025-04-18' },
      { name: 'Victoria Day', date: '2025-05-19' },
      { name: 'Canada Day', date: '2025-07-01' },
      { name: 'BC Day', date: '2025-08-04' },
      { name: 'Labour Day', date: '2025-09-01' },
      { name: 'Thanksgiving Day', date: '2025-10-13' },
      { name: 'Remembrance Day', date: '2025-11-11' },
      { name: 'Christmas Day', date: '2025-12-25' }
    ]
  };

  const getJurisdictionHolidays = useCallback(() => {
    const jurisdiction = settings?.tax_jurisdiction || 'ON';
    const jurisdictionKey = jurisdiction.toLowerCase();
    return CANADIAN_HOLIDAYS[jurisdictionKey] || CANADIAN_HOLIDAYS.ontario;
  }, [settings?.tax_jurisdiction]);

  // ✅ SIMPLIFIED: Just grab the most recent X periods based on pay frequency - NO DATE MATH
  const loadPayrollHistory = useCallback(async () => {
    if (!employee?.id || !selectedBusinessId || !selectedHolidayDate) {
      console.log('❌ Cannot load payroll history - missing requirements:', {
        hasEmployee: !!employee?.id,
        hasBusinessId: !!selectedBusinessId,
        hasHolidayDate: !!selectedHolidayDate
      });
      return;
    }

    try {
      setLoading(true);
      console.log('🔍 ========== LOADING PAYROLL HISTORY ==========');

      // ✅ Get business pay frequency from hrpayroll_settings table
      const { data: payrollSettings, error: settingsError } = await supabase
        .from('hrpayroll_settings')
        .select('pay_frequency')
        .eq('business_id', selectedBusinessId)
        .single();

      if (settingsError && settingsError.code !== 'PGRST116') {
        console.error('⚠️ Error loading payroll settings:', settingsError);
      }

      const payFrequency = payrollSettings?.pay_frequency || 'bi_weekly';
      console.log('📋 Pay frequency:', payFrequency);

      // ✅ ONTARIO ESA: Holiday pay = wages from 4 WORK WEEKS before the holiday ÷ 20
      // "4 work weeks" = 4 weekly pay periods OR 2 bi-weekly pay periods
      const periodsNeeded = payFrequency === 'weekly' ? 4 : 
                            payFrequency === 'bi_weekly' ? 2 :
                            payFrequency === 'semi_monthly' ? 2 :
                            payFrequency === 'monthly' ? 1 : 2;

      const holidayDate = new Date(selectedHolidayDate);

      console.log('📅 Calculation parameters:', {
        holidayDate: holidayDate.toISOString().split('T')[0],
        payFrequency: payFrequency,
        periodsNeeded: periodsNeeded
      });

      // ✅ Query 1: Get ALL regular entries BEFORE holiday, sorted by most recent
      console.log('🔎 Query 1: Searching for regular finalized payroll entries...');
      const { data: regularEntries, error: regularError } = await supabase
        .from('hrpayroll_entries')
        .select(`
          *,
          hrpayroll_runs!inner(
            pay_period_start,
            pay_period_end,
            pay_date,
            business_id,
            status
          )
        `)
        .eq('user_id', employee.id)
        .eq('hrpayroll_runs.business_id', selectedBusinessId)
        .eq('hrpayroll_runs.status', 'finalized')
        .lt('hrpayroll_runs.pay_period_end', holidayDate.toISOString().split('T')[0]) // Periods ending BEFORE holiday
        .not('payroll_run_id', 'is', null)
        .order('hrpayroll_runs(pay_period_end)', { ascending: false }); // Most recent first

      if (regularError) {
        console.error('❌ Error loading regular payroll history:', regularError);
      } else {
        console.log('✅ Regular payroll entries found:', regularEntries?.length || 0);
      }

      // ✅ Query 2: Get ALL migration entries BEFORE holiday, sorted by most recent
      console.log('🔎 Query 2: Searching for migration entries...');
      const { data: migrationEntries, error: migrationError } = await supabase
        .from('hrpayroll_entries')
        .select('*')
        .eq('user_id', employee.id)
        .eq('business_id', selectedBusinessId)
        .is('payroll_run_id', null)
        .lt('period_end_date', holidayDate.toISOString().split('T')[0]) // Periods ending BEFORE holiday
        .order('period_end_date', { ascending: false }); // Most recent first

      if (migrationError) {
        console.error('❌ Error loading migration payroll history:', migrationError);
      } else {
        console.log('✅ Migration entries found:', migrationEntries?.length || 0);
      }

      // ✅ FIXED: Calculate the specific periods that should be included
      // For Ontario ESA: 4 work weeks = 4 weekly periods OR 2 bi-weekly periods immediately before holiday
      const calculatedPeriods = [];
      
      if (payFrequency === 'weekly') {
        // For weekly: get the 4 weeks immediately before the holiday
        for (let i = 1; i <= 4; i++) {
          const periodEnd = new Date(holidayDate);
          periodEnd.setDate(periodEnd.getDate() - (i * 7)); // Go back i weeks
          calculatedPeriods.push({
            period_end: periodEnd.toISOString().split('T')[0],
            period_start: new Date(periodEnd.getTime() - (6 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0] // 6 days before end
          });
        }
      } else if (payFrequency === 'bi_weekly') {
        // For bi-weekly: get the 2 bi-weekly periods immediately before the holiday
        for (let i = 1; i <= 2; i++) {
          const periodEnd = new Date(holidayDate);
          periodEnd.setDate(periodEnd.getDate() - (i * 14)); // Go back i bi-weekly periods (14 days each)
          calculatedPeriods.push({
            period_end: periodEnd.toISOString().split('T')[0],
            period_start: new Date(periodEnd.getTime() - (13 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0] // 13 days before end
          });
        }
      } else {
        // Fallback: use the old logic for other frequencies
        const allEntries = [...(regularEntries || []), ...(migrationEntries || [])]
          .sort((a, b) => {
            const dateA = new Date(a.hrpayroll_runs?.pay_period_end || a.period_end_date);
            const dateB = new Date(b.hrpayroll_runs?.pay_period_end || b.period_end_date);
            return dateB - dateA; // Descending (newest first)
          })
          .slice(0, periodsNeeded);
        
        setPayrollHistory(allEntries);
        return;
      }
      
      console.log('📅 Calculated periods that should be included:', calculatedPeriods);
      console.log('📋 Available migration entries:', migrationEntries?.map(e => ({
        period_end: e.period_end_date,
        gross_pay: parseFloat(e.gross_pay || 0).toFixed(2)
      })) || []);
      console.log('📋 Available regular entries:', regularEntries?.map(e => ({
        period_end: e.hrpayroll_runs?.pay_period_end,
        gross_pay: parseFloat(e.gross_pay || 0).toFixed(2)
      })) || []);
      
      // ✅ Now find payroll entries for these specific periods (or create $0 entries for missing periods)
      const allEntries = [];
      
      for (const calculatedPeriod of calculatedPeriods) {
        // Look for existing payroll entry for this period (exact match or within 7 days)
        const existingEntry = [...(regularEntries || []), ...(migrationEntries || [])]
          .find(entry => {
            const entryPeriodEnd = entry.hrpayroll_runs?.pay_period_end || entry.period_end_date;
            const calculatedEnd = new Date(calculatedPeriod.period_end);
            const entryEnd = new Date(entryPeriodEnd);
            
            // Exact match or within 7 days (to handle slight date variations)
            const daysDiff = Math.abs((calculatedEnd - entryEnd) / (1000 * 60 * 60 * 24));
            return daysDiff <= 7;
          });
        
        if (existingEntry) {
          // Employee worked this period - use actual data
          allEntries.push(existingEntry);
          console.log(`✅ Found payroll for period ending ${calculatedPeriod.period_end}: $${parseFloat(existingEntry.gross_pay || 0).toFixed(2)}`);
        } else {
          // Employee didn't work this period - create $0 entry
          const zeroEntry = {
            gross_pay: 0,
            total_hours: 0,
            period_end_date: calculatedPeriod.period_end,
            hrpayroll_runs: {
              pay_period_end: calculatedPeriod.period_end,
              pay_period_start: calculatedPeriod.period_start
            },
            is_zero_period: true // Flag to identify this as a zero period
          };
          allEntries.push(zeroEntry);
          console.log(`⚠️ No payroll found for period ending ${calculatedPeriod.period_end} - using $0`);
        }
      }
      
      // Sort by period end date (newest first)
      allEntries.sort((a, b) => {
        const dateA = new Date(a.hrpayroll_runs?.pay_period_end || a.period_end_date);
        const dateB = new Date(b.hrpayroll_runs?.pay_period_end || b.period_end_date);
        return dateB - dateA; // Descending (newest first)
      });

      console.log('📊 ========== PAYROLL HISTORY SUMMARY ==========');
      console.log('Pay frequency:', payFrequency);
      console.log('Periods needed:', periodsNeeded);
      console.log('Periods selected for calculation:', allEntries.length);

      if (allEntries.length > 0) {
        const totalGross = allEntries.reduce((sum, e) => sum + parseFloat(e.gross_pay || 0), 0);
        const totalHours = allEntries.reduce((sum, e) => sum + parseFloat(e.total_hours || 0), 0);
        console.log('Total gross pay in period:', totalGross.toFixed(2));
        console.log('Total hours in period:', totalHours.toFixed(2));
        console.log('Entries detail:', allEntries.map(e => ({
          period_end: e.hrpayroll_runs?.pay_period_end || e.period_end_date,
          gross_pay: parseFloat(e.gross_pay || 0).toFixed(2),
          total_hours: parseFloat(e.total_hours || 0).toFixed(2),
          is_migration: e.is_migration_entry || !e.payroll_run_id
        })));
      } else {
        console.warn('⚠️ NO PAYROLL ENTRIES FOUND - Will use fallback calculation');
      }

      setPayrollHistory(allEntries);
      console.log('✅ ========== PAYROLL HISTORY LOAD COMPLETE ==========');

    } catch (err) {
      console.error('💥 CRITICAL ERROR in loadPayrollHistory:', err);
    } finally {
      setLoading(false);
    }
  }, [employee?.id, selectedBusinessId, selectedHolidayDate]);

  const calculateHolidayPay = useCallback(() => {
    if (!employee || !selectedHolidayDate) {
      console.log('❌ Cannot calculate - missing employee or date');
      setHolidayPayAmount(0);
      setCalculationDetails({});
      return;
    }

    console.log('💰 ========== CALCULATING HOLIDAY PAY ==========');
    console.log('Employee:', employee.first_name, employee.last_name);
    console.log('Holiday date:', selectedHolidayDate);
    console.log('Payroll history entries:', payrollHistory.length);
    console.log('Missed shift before?', missedShiftBefore);
    console.log('Missed shift after?', missedShiftAfter);

    // Check if disqualified by missed shifts
    if (missedShiftBefore || missedShiftAfter) {
      console.log('❌ DISQUALIFIED: Employee missed shifts');
      setIsEligible(false);
      setEligibilityReason('Not eligible due to missed shifts before/after holiday');
      setHolidayPayAmount(0);
      setCalculationDetails({
        method: 'Disqualified',
        reason: 'Missed shifts'
      });

      if (onHolidayPayChange) {
        onHolidayPayChange(0, {
          holidayDate: selectedHolidayDate,
          holidayName,
          isEligible: false,
          calculationDetails: { reason: 'Missed shifts' }
        });
      }
      return;
    }

    const jurisdiction = settings?.tax_jurisdiction || 'ON';
    const wage = parseFloat(employee.wage || 0);
    const employmentStartDate = employee.hire_date ? new Date(employee.hire_date) : null;
    const holidayDate = new Date(selectedHolidayDate);

    const daysEmployed = employmentStartDate ? 
      Math.floor((holidayDate - employmentStartDate) / (1000 * 60 * 60 * 24)) : 0;

    console.log('👤 Employee info:', {
      wage: wage,
      hire_date: employee.hire_date,
      days_employed: daysEmployed,
      jurisdiction: jurisdiction
    });

    if (daysEmployed < 30) {
      console.log('❌ DISQUALIFIED: Less than 30 days employed');
      setIsEligible(false);
      setEligibilityReason(`Employee must be employed for at least 30 days. Currently: ${daysEmployed} days.`);
      setHolidayPayAmount(0);
      return;
    }

    let holidayPay = 0;
    let calculationMethod = '';
    let details = {};

    console.log('🧮 Calculating for jurisdiction:', jurisdiction);

    if (jurisdiction === 'ON' || jurisdiction === 'federal') {
      if (payrollHistory.length > 0) {
        console.log('✅ Using actual payroll data (Ontario/Federal 1/20th method)');
        const totalWages = payrollHistory.reduce((sum, entry) => {
          const gross = parseFloat(entry.gross_pay || 0);
          const periodEnd = entry.hrpayroll_runs?.pay_period_end || entry.period_end_date;
          console.log(`  Period ending ${periodEnd}: $${gross.toFixed(2)}`);
          return sum + gross;
        }, 0);

        holidayPay = totalWages / 20;
        calculationMethod = jurisdiction === 'ON' ? 'Ontario ESA: 1/20th of wages from 4 work weeks' : 'Canada Labour Code: 1/20th of wages from 4 work weeks';
        details = {
          totalWages: totalWages.toFixed(2),
          payrollEntries: payrollHistory.length,
          calculation: `$${totalWages.toFixed(2)} ÷ 20 = $${holidayPay.toFixed(2)}`,
          entries: payrollHistory.map(e => ({
            date: e.hrpayroll_runs?.pay_period_end || e.period_end_date,
            amount: parseFloat(e.gross_pay || 0).toFixed(2),
            isZeroPeriod: e.is_zero_period || false
          }))
        };
        console.log('💵 Calculation result:', details.calculation);
      } else {
        console.log('⚠️ Using FALLBACK calculation (no payroll history)');
        holidayPay = (wage * 40) / 5;
        calculationMethod = 'Estimated average day\'s pay (FALLBACK - no payroll history found)';
        details = {
          weeklyWage: (wage * 40).toFixed(2),
          dailyWage: holidayPay.toFixed(2),
          calculation: `($${wage}/hour × 40 hours) ÷ 5 days = $${holidayPay.toFixed(2)}`,
          warning: 'No payroll history found for calculation period'
        };
        console.log('💵 Fallback calculation:', details.calculation);
      }
    } else if (jurisdiction === 'BC') {
      if (payrollHistory.length > 0) {
        const totalWages = payrollHistory.reduce((sum, entry) => sum + parseFloat(entry.gross_pay || 0), 0);
        const totalDaysWorked = payrollHistory.reduce((sum, entry) => {
          const hoursWorked = parseFloat(entry.total_hours || 0);
          return sum + (hoursWorked > 0 ? 1 : 0);
        }, 0);

        holidayPay = totalDaysWorked > 0 ? totalWages / totalDaysWorked : wage * 8;
        calculationMethod = 'BC ESA: Average day\'s pay from 30-day period';
        details = {
          totalWages: totalWages.toFixed(2),
          totalDaysWorked,
          calculation: `$${totalWages.toFixed(2)} ÷ ${totalDaysWorked} days = $${holidayPay.toFixed(2)}`
        };
      } else {
        holidayPay = wage * 8;
        calculationMethod = 'BC ESA: Estimated 8-hour day (fallback)';
        details = {
          hourlyWage: wage,
          hoursPerDay: 8,
          calculation: `$${wage}/hour × 8 hours = $${holidayPay.toFixed(2)}`
        };
      }
    } else if (jurisdiction === 'AB') {
      if (payrollHistory.length > 0) {
        const totalWages = payrollHistory.reduce((sum, entry) => sum + parseFloat(entry.gross_pay || 0), 0);
        const totalDaysWorked = payrollHistory.reduce((sum, entry) => {
          const hoursWorked = parseFloat(entry.total_hours || 0);
          return sum + (hoursWorked > 0 ? 1 : 0);
        }, 0);

        holidayPay = totalDaysWorked > 0 ? totalWages / totalDaysWorked : wage * 8;
        calculationMethod = 'Alberta ESC: Average day\'s wage from 28-day period';
        details = {
          totalWages: totalWages.toFixed(2),
          totalDaysWorked,
          calculation: `$${totalWages.toFixed(2)} ÷ ${totalDaysWorked} days = $${holidayPay.toFixed(2)}`
        };
      } else {
        holidayPay = wage * 8;
        calculationMethod = 'Alberta ESC: Estimated 8-hour day (fallback)';
        details = {
          hourlyWage: wage,
          calculation: `$${wage}/hour × 8 hours = $${holidayPay.toFixed(2)}`
        };
      }
    }

    console.log('✅ ========== CALCULATION COMPLETE ==========');
    console.log('Holiday pay amount:', holidayPay.toFixed(2));
    console.log('Method:', calculationMethod);
    console.log('Details:', details);

    setIsEligible(true);
    setEligibilityReason(`Eligible: ${daysEmployed} days employed (minimum 30 required)`);
    setHolidayPayAmount(holidayPay);
    setCalculationDetails({
      method: calculationMethod,
      jurisdiction,
      holidayDate: selectedHolidayDate,
      employeeName: `${employee.first_name} ${employee.last_name}`,
      daysEmployed,
      ...details
    });

    console.log('📞 Calling onHolidayPayChange callback with:', holidayPay);

    if (onHolidayPayChange) {
      onHolidayPayChange(holidayPay, {
        holidayDate: selectedHolidayDate,
        holidayName,
        isEligible: true,
        calculationDetails: {
          method: calculationMethod,
          jurisdiction,
          ...details
        }
      });
    }
    console.log('✅ ========== HOLIDAY PAY PROCESS COMPLETE ==========');

  }, [employee, selectedHolidayDate, settings?.tax_jurisdiction, payrollHistory, onHolidayPayChange, holidayName, missedShiftBefore, missedShiftAfter]);

  const handleHolidayDateChange = async (date) => {
    try {
      console.log('📅 Holiday date changed to:', date);
      const validation = await validateInput(date, 'date', 'date');
      if (!validation.valid) {
        console.error('❌ Invalid date:', validation.error);
        return;
      }

      setSelectedHolidayDate(date);

      const holidays = getJurisdictionHolidays();
      const matchingHoliday = holidays.find(h => h.date === date);

      if (matchingHoliday) {
        console.log('🎉 Matched statutory holiday:', matchingHoliday.name);
        setHolidayName(matchingHoliday.name);
      } else {
        console.log('📝 Custom holiday date selected');
        setHolidayName('Custom Holiday');
      }

      await logSecurityEvent('holiday_date_selected', {
        employee_id: employee?.id,
        holiday_date: date,
        holiday_name: matchingHoliday?.name || 'Custom Holiday',
        business_id: selectedBusinessId
      }, 'low');

    } catch (error) {
      console.error('💥 Error handling holiday date change:', error);
    }
  };

  const handleStatHolidayClick = (holiday) => {
    console.log('🎯 Statutory holiday clicked:', holiday.name, holiday.date);
    setSelectedHolidayDate(holiday.date);
    setHolidayName(holiday.name);
  };

  useEffect(() => {
    console.log('🔄 Effect triggered - loading payroll history');
    if (selectedHolidayDate && employee?.id && selectedBusinessId) {
      loadPayrollHistory();
    }
  }, [selectedHolidayDate, employee?.id, selectedBusinessId, loadPayrollHistory]);

  useEffect(() => {
    if (selectedHolidayDate && payrollHistory.length > 0) {
      calculateHolidayPay();
    }
  }, [selectedHolidayDate, payrollHistory.length, missedShiftBefore, missedShiftAfter]);
  const suggestedHolidays = useMemo(() => {
    const holidays = getJurisdictionHolidays();
    const currentDate = new Date();
    const payPeriodStart = payPeriod?.start ? new Date(payPeriod.start) : currentDate;
    const payPeriodEnd = payPeriod?.end ? new Date(payPeriod.end) : new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    return holidays.filter(holiday => {
      const holidayDate = new Date(holiday.date);
      return holidayDate >= new Date(payPeriodStart.getTime() - 30 * 24 * 60 * 60 * 1000) &&
             holidayDate <= new Date(payPeriodEnd.getTime() + 30 * 24 * 60 * 60 * 1000);
    });
  }, [getJurisdictionHolidays, payPeriod]);

  const styles = {
    container: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    dateSection: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.md
    },
    formGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700
    },
    input: {
      padding: '10px 12px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography.fontSize.sm,
      backgroundColor: TavariStyles.colors.white
    },
    suggestedHolidays: {
      marginTop: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.md
    },
    suggestedTitle: {
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xs
    },
    holidayChips: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.xs
    },
    holidayChip: {
      padding: '6px 12px',
      backgroundColor: TavariStyles.colors.gray50,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: '16px',
      fontSize: TavariStyles.typography.fontSize.xs,
      cursor: 'pointer',
      transition: 'all 0.2s',
      ':hover': {
        backgroundColor: TavariStyles.colors.primary,
        color: TavariStyles.colors.white,
        borderColor: TavariStyles.colors.primary
      }
    },
    resultSection: {
      marginTop: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '8px'
    },
    eligibilityBadge: {
      display: 'inline-block',
      padding: '4px 12px',
      borderRadius: '12px',
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    eligible: {
      backgroundColor: '#dcfce7',
      color: '#166534'
    },
    notEligible: {
      backgroundColor: '#fee2e2',
      color: '#991b1b'
    },
    amountDisplay: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      marginTop: TavariStyles.spacing.sm
    },
    calculationBox: {
      marginTop: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.sm || '4px'
    },
    calculationTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.sm,
      color: TavariStyles.colors.gray700
    },
    calculationText: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      lineHeight: 1.6
    },
    payrollEntriesTable: {
      width: '100%',
      marginTop: TavariStyles.spacing.sm,
      borderCollapse: 'collapse'
    },
    tableHeader: {
      padding: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.gray100,
      textAlign: 'left',
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      borderBottom: `2px solid ${TavariStyles.colors.gray300}`
    },
    tableCell: {
      padding: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`
    },
    warningBox: {
      marginTop: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      backgroundColor: '#fef3c7',
      border: '1px solid #fbbf24',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography.fontSize.sm,
      color: '#92400e'
    }
  };

  return (
    <SecurityWrapper>
      <div style={styles.container}>
        <h4 style={{
          fontSize: TavariStyles.typography.fontSize.md,
          fontWeight: TavariStyles.typography.fontWeight.semibold,
          marginBottom: TavariStyles.spacing.md,
          color: TavariStyles.colors.gray800
        }}>
          Holiday Pay Calculator
        </h4>

        <div style={styles.dateSection}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Holiday Date</label>
            <input
              type="date"
              style={styles.input}
              value={selectedHolidayDate}
              onChange={(e) => handleHolidayDateChange(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Holiday Name</label>
            <input
              type="text"
              style={styles.input}
              value={holidayName}
              onChange={(e) => setHolidayName(e.target.value)}
              placeholder="Enter holiday name"
            />
          </div>
        </div>

        {suggestedHolidays.length > 0 && (
          <div style={styles.suggestedHolidays}>
            <div style={styles.suggestedTitle}>Suggested Statutory Holidays:</div>
            <div style={styles.holidayChips}>
              {suggestedHolidays.map((holiday, idx) => (
                <div
                  key={idx}
                  style={styles.holidayChip}
                  onClick={() => handleStatHolidayClick(holiday)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = TavariStyles.colors.primary;
                    e.currentTarget.style.color = TavariStyles.colors.white;
                    e.currentTarget.style.borderColor = TavariStyles.colors.primary;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = TavariStyles.colors.gray50;
                    e.currentTarget.style.color = TavariStyles.colors.gray700;
                    e.currentTarget.style.borderColor = TavariStyles.colors.gray300;
                  }}
                >
                  {holiday.name} ({holiday.date})
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedHolidayDate && !loading && (
          <>
            <div style={styles.resultSection}>
              <div>
                <span
                  style={{
                    ...styles.eligibilityBadge,
                    ...(isEligible ? styles.eligible : styles.notEligible)
                  }}
                >
                  {isEligible ? '✓ Eligible' : '✗ Not Eligible'}
                </span>
                <div style={{
                  fontSize: TavariStyles.typography.fontSize.sm,
                  color: TavariStyles.colors.gray600,
                  marginTop: TavariStyles.spacing.xs
                }}>
                  {eligibilityReason}
                </div>
              </div>

              <div style={styles.amountDisplay}>
                Holiday Pay: ${formatAmount ? formatAmount(holidayPayAmount) : formatTaxAmount ? formatTaxAmount(holidayPayAmount) : holidayPayAmount.toFixed(2)}
              </div>

              <div style={styles.calculationBox}>
                <div style={styles.calculationTitle}>Calculation Method</div>
                <div style={styles.calculationText}>
                  <strong>Method:</strong> {calculationDetails.method}<br/>
                  <strong>Jurisdiction:</strong> {calculationDetails.jurisdiction}<br/>
                  <strong>Formula:</strong> {calculationDetails.calculation}
                </div>
              </div>

              {calculationDetails.payrollEntries > 0 && calculationDetails.entries && (
                <div style={styles.calculationBox}>
                  <div style={styles.calculationTitle}>
                    Based on {calculationDetails.payrollEntries} Payroll Period{calculationDetails.payrollEntries > 1 ? 's' : ''}
                  </div>
                  <table style={styles.payrollEntriesTable}>
                    <thead>
                      <tr>
                        <th style={styles.tableHeader}>Period End Date</th>
                        <th style={styles.tableHeader}>Gross Pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calculationDetails.entries.map((entry, idx) => (
                        <tr key={idx}>
                          <td style={styles.tableCell}>
                            {entry.date}
                            {entry.isZeroPeriod && (
                              <span style={{color: '#666', fontSize: '0.9em', marginLeft: '8px'}}>
                                (No work)
                              </span>
                            )}
                          </td>
                          <td style={{
                            ...styles.tableCell,
                            color: entry.isZeroPeriod ? '#999' : 'inherit'
                          }}>
                            ${entry.amount}
                          </td>
                        </tr>
                      ))}
                      <tr style={{fontWeight: 'bold'}}>
                        <td style={{...styles.tableCell, fontWeight: 'bold'}}>Total</td>
                        <td style={{...styles.tableCell, fontWeight: 'bold'}}>${calculationDetails.totalWages}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {calculationDetails.warning && (
                <div style={styles.warningBox}>
                  <strong>⚠️ Warning:</strong> {calculationDetails.warning}
                </div>
              )}
            </div>
          </>
        )}

        {loading && (
          <div style={{padding: TavariStyles.spacing.lg, textAlign: 'center', color: TavariStyles.colors.gray600}}>
            Loading payroll history...
          </div>
        )}
      </div>
    </SecurityWrapper>
  );
};

export default HolidayPayCalculator;