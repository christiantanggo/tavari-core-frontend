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
import { getCanadianStatHolidaysForPeriod } from '../../../utils/canadianStatHolidays';

const HolidayPayCalculator = ({
  employee,
  selectedBusinessId,
  onHolidayPayChange,
  payPeriod,
  settings,
  formatAmount,
  missedShiftBefore,
  missedShiftAfter,
  initialHolidayDate = ''
}) => {
  const [selectedHolidayDate, setSelectedHolidayDate] = useState(initialHolidayDate || '');
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

  const getJurisdictionHolidays = useCallback(() => {
    const jurisdiction = settings?.tax_jurisdiction || 'ON';
    return getCanadianStatHolidaysForPeriod({
      jurisdiction,
      periodStart: payPeriod?.start,
      periodEnd: payPeriod?.end
    });
  }, [settings?.tax_jurisdiction, payPeriod?.start, payPeriod?.end]);

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
      // Include both 'finalized' and 'edited' status runs (edited runs are finalized runs that were modified)
      console.log('🔎 Query 1: Searching for regular finalized/edited payroll entries...');
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
        .in('hrpayroll_runs.status', ['finalized', 'edited']) // Include both finalized and edited runs
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
        // Pay weeks are Sunday-Saturday, so period end dates should be Saturdays
        // Find the most recent Saturday before (or on) the holiday
        const holidayDateObj = new Date(holidayDate);
        const holidayDayOfWeek = holidayDateObj.getDay(); // 0=Sunday, 6=Saturday
        const daysToLastSaturday = holidayDayOfWeek === 6 ? 0 : holidayDayOfWeek + 1; // Days to go back to get to Saturday
        const lastSaturdayBeforeHoliday = new Date(holidayDateObj);
        lastSaturdayBeforeHoliday.setDate(holidayDateObj.getDate() - daysToLastSaturday);
        lastSaturdayBeforeHoliday.setHours(12, 0, 0, 0); // Set to noon to avoid timezone issues
        
        for (let i = 1; i <= 4; i++) {
          const periodEnd = new Date(lastSaturdayBeforeHoliday);
          periodEnd.setDate(lastSaturdayBeforeHoliday.getDate() - ((i - 1) * 7)); // Go back (i-1) * 7 days from last Saturday
          const periodStart = new Date(periodEnd);
          periodStart.setDate(periodEnd.getDate() - 6); // 6 days before (Sunday to Saturday = 7 days, start is Sunday)
          calculatedPeriods.push({
            period_end: periodEnd.toISOString().split('T')[0],
            period_start: periodStart.toISOString().split('T')[0]
          });
        }
      } else if (payFrequency === 'bi_weekly') {
        // For bi-weekly: get the 2 bi-weekly periods immediately before the holiday
        // Pay weeks are Sunday-Saturday, so period end dates should be Saturdays
        // Find the most recent Saturday before (or on) the holiday
        const holidayDateObj = new Date(holidayDate);
        const holidayDayOfWeek = holidayDateObj.getDay(); // 0=Sunday, 6=Saturday
        const daysToLastSaturday = holidayDayOfWeek === 6 ? 0 : holidayDayOfWeek + 1; // Days to go back to get to Saturday
        const lastSaturdayBeforeHoliday = new Date(holidayDateObj);
        lastSaturdayBeforeHoliday.setDate(holidayDateObj.getDate() - daysToLastSaturday);
        lastSaturdayBeforeHoliday.setHours(12, 0, 0, 0); // Set to noon to avoid timezone issues
        
        for (let i = 1; i <= 2; i++) {
          const periodEnd = new Date(lastSaturdayBeforeHoliday);
          periodEnd.setDate(lastSaturdayBeforeHoliday.getDate() - ((i - 1) * 14)); // Go back (i-1) * 14 days from last Saturday
          const periodStart = new Date(periodEnd);
          periodStart.setDate(periodEnd.getDate() - 13); // 13 days before (Sunday to Saturday = 14 days, start is Sunday)
          calculatedPeriods.push({
            period_end: periodEnd.toISOString().split('T')[0],
            period_start: periodStart.toISOString().split('T')[0]
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
      
      // ✅ IMPROVED: ALWAYS use actual payroll periods when available
      // This is more reliable than calculating theoretical dates and trying to match them
      // For bi-weekly: we need 2 periods, so take the 2 most recent payroll entries
      // For weekly: we need 4 periods, so take the 4 most recent payroll entries
      const allAvailableEntries = [...(regularEntries || []), ...(migrationEntries || [])]
        .sort((a, b) => {
          const dateA = new Date(a.hrpayroll_runs?.pay_period_end || a.period_end_date);
          const dateB = new Date(b.hrpayroll_runs?.pay_period_end || b.period_end_date);
          return dateB - dateA; // Descending (newest first)
        });
      
      if (allAvailableEntries.length > 0) {
        const periodsNeeded = payFrequency === 'weekly' ? 4 : 
                             payFrequency === 'bi_weekly' ? 2 :
                             payFrequency === 'semi_monthly' ? 2 :
                             payFrequency === 'monthly' ? 1 : 2;
        
        const actualPeriods = allAvailableEntries.slice(0, periodsNeeded);
        console.log(`📊 Using actual payroll periods (${payFrequency}) - taking ${periodsNeeded} most recent entries`);
        console.log(`✅ Found ${actualPeriods.length} actual payroll entries:`, actualPeriods.map(e => ({
          period_end: e.hrpayroll_runs?.pay_period_end || e.period_end_date,
          gross_pay: parseFloat(e.gross_pay || 0).toFixed(2),
          employee: e.user_id
        })));
        setPayrollHistory(actualPeriods);
        return;
      }
      
      console.warn('⚠️ No payroll entries found, will use calculated periods with $0 fallback');
      
      // ✅ Fallback: If no regular entries found, try to match calculated periods
      // This handles cases where payroll might be in migration entries or dates don't align
      const allEntries = [];
      const usedEntryIds = new Set(); // Track which entries we've already used
      
      for (const calculatedPeriod of calculatedPeriods) {
        // Look for existing payroll entry for this period (exact match or within 14 days for bi-weekly)
        // Increased tolerance to 14 days to handle cases where payroll dates don't perfectly align
        const toleranceDays = payFrequency === 'bi_weekly' ? 14 : 7;
        const existingEntry = [...(regularEntries || []), ...(migrationEntries || [])]
          .find(entry => {
            // Skip if we've already used this entry
            const entryId = entry.id || entry.payroll_run_id;
            if (usedEntryIds.has(entryId)) return false;
            
            const entryPeriodEnd = entry.hrpayroll_runs?.pay_period_end || entry.period_end_date;
            if (!entryPeriodEnd) return false;
            
            const calculatedEnd = new Date(calculatedPeriod.period_end);
            const entryEnd = new Date(entryPeriodEnd);
            
            // Match if within tolerance days
            const daysDiff = Math.abs((calculatedEnd - entryEnd) / (1000 * 60 * 60 * 24));
            return daysDiff <= toleranceDays;
          });
        
        if (existingEntry) {
          // Employee worked this period - use actual data
          const entryId = existingEntry.id || existingEntry.payroll_run_id;
          usedEntryIds.add(entryId);
          allEntries.push(existingEntry);
          const entryPeriodEnd = existingEntry.hrpayroll_runs?.pay_period_end || existingEntry.period_end_date;
          console.log(`✅ Found payroll for period ending ${entryPeriodEnd} (calculated: ${calculatedPeriod.period_end}): $${parseFloat(existingEntry.gross_pay || 0).toFixed(2)}`);
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
          console.log(`⚠️ No payroll found for period ending ${calculatedPeriod.period_end} (within ${toleranceDays} days) - using $0`);
          console.log(`   Searched in ${(regularEntries || []).length} regular entries and ${(migrationEntries || []).length} migration entries`);
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
    const holidayDate = new Date(selectedHolidayDate);

    console.log('👤 Employee info:', {
      wage: wage,
      jurisdiction: jurisdiction
    });

    // ✅ ONTARIO ESA: All employees are eligible for holiday pay regardless of employment period
    // The ONLY eligibility requirement is the "last and first" rule:
    // - Employee must work their last scheduled shift before the holiday
    // - Employee must work their first scheduled shift after the holiday
    // (This is already checked above via missedShiftBefore and missedShiftAfter)

    let holidayPay = 0;
    let calculationMethod = '';
    let details = {};

    console.log('🧮 Calculating for jurisdiction:', jurisdiction);

    if (jurisdiction === 'ON' || jurisdiction === 'federal') {
      if (payrollHistory.length > 0) {
        console.log('✅ Using actual payroll data (Ontario/Federal 1/20th method)');
        
        // ✅ ONTARIO ESA: Holiday pay = (Regular wages + Vacation pay) from 4 work weeks ÷ 20
        // Regular wages = regular pay + lieu time paid out (excludes overtime, stat worked, shift premiums)
        const totalRegularWages = payrollHistory.reduce((sum, entry) => {
          let regularPay = 0;
          let lieuPayOut = 0;
          const vacationPay = parseFloat(entry.vacation_pay || 0);
          const periodEnd = entry.hrpayroll_runs?.pay_period_end || entry.period_end_date;
          
          // Try to get regular pay from wage_breakdown (most accurate)
          try {
            if (entry.wage_breakdown) {
              const wageBreakdown = typeof entry.wage_breakdown === 'string' ? 
                JSON.parse(entry.wage_breakdown) : entry.wage_breakdown;
              
              if (Array.isArray(wageBreakdown)) {
                // Sum regular_pay (or pay) from all periods
                // ✅ INCLUDE lieu payments (lieu time paid out counts as regular wages)
                wageBreakdown.forEach(period => {
                  if (period.is_lieu_payment) {
                    // Lieu time paid out during lookback period MUST be included as regular wages
                    lieuPayOut += parseFloat(period.lieu_pay || 0);
                  } else {
                    regularPay += parseFloat(period.regular_pay || period.pay || 0);
                  }
                });
              }
            }
          } catch (e) {
            console.warn('Error parsing wage_breakdown for entry:', e);
          }
          
          // Fallback: Calculate from regular_hours * wage if wage_breakdown doesn't exist
          if (regularPay === 0 && entry.regular_hours) {
            const regularHours = parseFloat(entry.regular_hours || 0);
            const entryWage = parseFloat(entry.wage || employee.wage || wage || 0);
            regularPay = regularHours * entryWage;
          }
          
          // ✅ Also include lieu_hours paid out in fallback calculation
          if (entry.lieu_hours && entry.lieu_hours > 0) {
            const lieuHours = parseFloat(entry.lieu_hours || 0);
            const entryWage = parseFloat(entry.wage || employee.wage || wage || 0);
            lieuPayOut += lieuHours * entryWage;
          }
          
          const totalRegularWages = regularPay + lieuPayOut;
          const regularWagesPlusVacation = totalRegularWages + vacationPay;
          console.log(`  Period ending ${periodEnd}: Regular: $${regularPay.toFixed(2)}, Lieu Paid: $${lieuPayOut.toFixed(2)}, Vacation: $${vacationPay.toFixed(2)}, Total: $${regularWagesPlusVacation.toFixed(2)}`);
          return sum + regularWagesPlusVacation;
        }, 0);

        holidayPay = totalRegularWages / 20;
        calculationMethod = jurisdiction === 'ON' ? 'Ontario ESA: 1/20th of (regular wages + lieu time paid out + vacation pay) from 4 work weeks' : 'Canada Labour Code: 1/20th of (regular wages + lieu time paid out + vacation pay) from 4 work weeks';
        details = {
          totalRegularWages: totalRegularWages.toFixed(2),
          payrollEntries: payrollHistory.length,
          calculation: `$${totalRegularWages.toFixed(2)} ÷ 20 = $${holidayPay.toFixed(2)}`,
          entries: payrollHistory.map(e => {
            let regularPay = 0;
            let lieuPayOut = 0;
            try {
              if (e.wage_breakdown) {
                const wageBreakdown = typeof e.wage_breakdown === 'string' ? 
                  JSON.parse(e.wage_breakdown) : e.wage_breakdown;
                if (Array.isArray(wageBreakdown)) {
                  wageBreakdown.forEach(period => {
                    if (period.is_lieu_payment) {
                      lieuPayOut += parseFloat(period.lieu_pay || 0);
                    } else {
                      regularPay += parseFloat(period.regular_pay || period.pay || 0);
                    }
                  });
                }
              }
            } catch (err) {
              // Fallback calculation
              const regularHours = parseFloat(e.regular_hours || 0);
              const entryWage = parseFloat(e.wage || employee.wage || wage || 0);
              regularPay = regularHours * entryWage;
              // Include lieu hours paid out in fallback
              if (e.lieu_hours && e.lieu_hours > 0) {
                lieuPayOut = parseFloat(e.lieu_hours || 0) * entryWage;
              }
            }
            const vacationPay = parseFloat(e.vacation_pay || 0);
            const totalRegularWages = regularPay + lieuPayOut;
            return {
              date: e.hrpayroll_runs?.pay_period_end || e.period_end_date,
              regularWages: regularPay.toFixed(2),
              lieuPaidOut: lieuPayOut.toFixed(2),
              vacationPay: vacationPay.toFixed(2),
              total: (totalRegularWages + vacationPay).toFixed(2),
              isZeroPeriod: e.is_zero_period || false
            };
          })
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
    setEligibilityReason('Eligible: All employees are entitled to holiday pay under Ontario ESA (subject to last/first shift rule)');
    setHolidayPayAmount(holidayPay);
    setCalculationDetails({
      method: calculationMethod,
      jurisdiction,
      holidayDate: selectedHolidayDate,
      employeeName: `${employee.first_name} ${employee.last_name}`,
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
    if (!initialHolidayDate || initialHolidayDate === selectedHolidayDate) return;
    handleHolidayDateChange(initialHolidayDate);
  }, [initialHolidayDate]);

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
                        <th style={{...styles.tableHeader, textAlign: 'right'}}>Regular Wages</th>
                        <th style={{...styles.tableHeader, textAlign: 'right'}}>Lieu Paid Out</th>
                        <th style={{...styles.tableHeader, textAlign: 'right'}}>Vacation Pay</th>
                        <th style={{...styles.tableHeader, textAlign: 'right'}}>Weekly Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calculationDetails.entries.map((entry, idx) => {
                        const regularWages = parseFloat(entry.regularWages || 0);
                        const lieuPaidOut = parseFloat(entry.lieuPaidOut || 0);
                        const vacationPay = parseFloat(entry.vacationPay || 0);
                        const weeklyTotal = regularWages + lieuPaidOut + vacationPay;
                        return (
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
                              color: entry.isZeroPeriod ? '#999' : 'inherit',
                              textAlign: 'right'
                            }}>
                              ${regularWages.toFixed(2)}
                            </td>
                            <td style={{
                              ...styles.tableCell,
                              color: entry.isZeroPeriod ? '#999' : 'inherit',
                              textAlign: 'right'
                            }}>
                              {lieuPaidOut > 0 ? `$${lieuPaidOut.toFixed(2)}` : '-'}
                            </td>
                            <td style={{
                              ...styles.tableCell,
                              color: entry.isZeroPeriod ? '#999' : 'inherit',
                              textAlign: 'right'
                            }}>
                              ${vacationPay.toFixed(2)}
                            </td>
                            <td style={{
                              ...styles.tableCell,
                              color: entry.isZeroPeriod ? '#999' : 'inherit',
                              fontWeight: 'bold',
                              textAlign: 'right'
                            }}>
                              ${weeklyTotal.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                      <tr style={{fontWeight: 'bold', borderTop: '2px solid #333'}}>
                        <td style={{...styles.tableCell, fontWeight: 'bold'}}>Total</td>
                        <td style={{...styles.tableCell, fontWeight: 'bold', textAlign: 'right'}}>
                          ${calculationDetails.entries.reduce((sum, e) => sum + parseFloat(e.regularWages || 0), 0).toFixed(2)}
                        </td>
                        <td style={{...styles.tableCell, fontWeight: 'bold', textAlign: 'right'}}>
                          ${calculationDetails.entries.reduce((sum, e) => sum + parseFloat(e.lieuPaidOut || 0), 0).toFixed(2)}
                        </td>
                        <td style={{...styles.tableCell, fontWeight: 'bold', textAlign: 'right'}}>
                          ${calculationDetails.entries.reduce((sum, e) => sum + parseFloat(e.vacationPay || 0), 0).toFixed(2)}
                        </td>
                        <td style={{...styles.tableCell, fontWeight: 'bold', textAlign: 'right'}}>
                          ${calculationDetails.totalRegularWages}
                        </td>
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