// hooks/useYTDCalculations.js - FIXED: Removed circular imports, corrected database queries
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useSecurityContext } from '../Security';
import { usePOSAuth } from './usePOSAuth';

/**
 * Comprehensive YTD (Year-to-Date) calculations hook for Tavari HR system
 * FIXED: Removed circular component imports, corrected database schema references
 * 
 * @param {string} businessId - Business ID to load YTD data for
 * @returns {Object} YTD calculation functions and data management
 */
export const useYTDCalculations = (businessId) => {
  const [ytdData, setYTDData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastCalculation, setLastCalculation] = useState(null);

  // Security context for sensitive YTD calculations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'useYTDCalculations',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  // Authentication context - Allow all roles including employees for YTD calculations
  // Employees need to see their own YTD data
  const {
    selectedBusinessId: authSelectedBusinessId,
    authUser,
    userRole,
    businessData
  } = usePOSAuth({
    requiredRoles: null, // Allow all roles - employees need YTD too
    requireBusiness: true,
    componentName: 'useYTDCalculations'
  });

  /**
   * Load YTD data when businessId changes
   * Use passed businessId parameter OR authSelectedBusinessId from usePOSAuth
   */
  useEffect(() => {
    const effectiveBusinessId = businessId || authSelectedBusinessId;
    if (effectiveBusinessId) {
      loadYTDData(effectiveBusinessId);
    } else {
      setYTDData({});
      setLoading(false);
    }
  }, [businessId, authSelectedBusinessId]);

  /**
   * Load existing YTD data from database
   */
  const loadYTDData = async (businessId) => {
    setLoading(true);
    setError(null);
    
    try {
      await logSecurityEvent('ytd_data_accessed', {
        business_id: businessId,
        action: 'load_ytd_data'
      }, 'medium');

      const currentYear = new Date().getFullYear();
      
      const { data, error } = await supabase
        .from('hrpayroll_ytd_data')
        .select('*')
        .eq('business_id', businessId)
        .eq('tax_year', currentYear);

      if (error) throw error;

      // Convert array to object with user_id as key for easy lookup
      const ytdDataMap = {};
      data.forEach(ytd => {
        ytdDataMap[ytd.user_id] = ytd;
      });

      setYTDData(ytdDataMap);
      setLastCalculation(new Date().toISOString());

    } catch (error) {
      console.error('Error loading YTD data:', error);
      setError(error.message);
      await logSecurityEvent('ytd_data_load_error', {
        business_id: businessId,
        error: error.message
      }, 'high');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Calculate YTD totals for a specific employee up to a specific date
   * FIXED: Corrected database schema and field references
   */
  const calculateEmployeeYTD = useCallback(async (userId, upToDate = null, businessIdOverride = null) => {
    // Use businessIdOverride (explicitly passed) OR passed businessId parameter OR authSelectedBusinessId from usePOSAuth
    const effectiveBusinessId = businessIdOverride || businessId || authSelectedBusinessId;
    if (!effectiveBusinessId) {
      console.error('[YTD Calculation] No business ID available', {
        businessIdOverride,
        businessId,
        authSelectedBusinessId,
        userId,
        upToDate
      });
      return null;
    }
    
    console.log('[YTD Calculation] Using business ID:', effectiveBusinessId, {
      source: businessIdOverride ? 'override' : (businessId ? 'parameter' : 'auth'),
      userId,
      upToDate
    });

    try {
      const targetDate = upToDate ? new Date(upToDate) : new Date();
      const currentYear = targetDate.getFullYear();
      const yearStart = new Date(currentYear, 0, 1);

      // Get stored YTD data
      const storedYTD = ytdData[userId] || {
        hours_worked: 0,
        regular_income: 0,
        overtime_income: 0,
        lieu_income: 0,
        vacation_pay: 0,
        shift_premiums: 0,
        stat_earnings: 0,
        holiday_earnings: 0,
        bonus: 0,
        federal_tax: 0,
        provincial_tax: 0,
        cpp_deduction: 0,
        ei_deduction: 0,
        additional_tax: 0,
        gross_pay: 0,
        net_pay: 0,
        last_updated: yearStart.toISOString()
      };

      // ORIGINAL WORKING LOGIC: Use stored YTD as base, add entries since last update
      // This preserves migration data that's already in storedYTD
      const lastUpdated = new Date(storedYTD.last_updated || yearStart);
      
      // CRITICAL: If stored YTD is empty (all zeros), it means no data was stored yet
      // In this case, we need to calculate from year start, not from lastUpdated
      const hasStoredData = storedYTD.gross_pay > 0 || storedYTD.net_pay > 0 || storedYTD.federal_tax > 0;
      const calculateFromDate = (hasStoredData && lastUpdated > yearStart) ? lastUpdated : yearStart;
      
      console.log(`[YTD Calculation] Calculating YTD for user ${userId} from ${calculateFromDate.toISOString().split('T')[0]} to ${targetDate.toISOString().split('T')[0]}`);
      console.log(`[YTD Calculation] Stored YTD last_updated: ${lastUpdated.toISOString().split('T')[0]}`);
      console.log(`[YTD Calculation] Has stored data: ${hasStoredData}, Using stored YTD as base:`, {
        gross_pay: storedYTD.gross_pay,
        net_pay: storedYTD.net_pay,
        federal_tax: storedYTD.federal_tax
      });
      
      // Query entries since last update (stored YTD already includes everything before this)
      // If stored YTD is empty, query from year start to get ALL entries including migration
      const { data: regularEntries, error } = await supabase
        .from('hrpayroll_entries')
        .select(`
          *,
          hrpayroll_runs!inner (
            pay_date,
            business_id
          )
        `)
        .eq('user_id', userId)
        .eq('hrpayroll_runs.business_id', effectiveBusinessId)
        .gte('hrpayroll_runs.pay_date', calculateFromDate.toISOString().split('T')[0])
        .lte('hrpayroll_runs.pay_date', targetDate.toISOString().split('T')[0]);
      
      // CRITICAL: Migration entries represent data from the old payroll system
      // They don't have hrpayroll_runs (payroll_run_id is null), so they're NOT included in the regular query above
      // We MUST query them separately and include them in the calculation
      // 
      // Logic:
      // - If stored YTD is empty: Calculate from year start, include ALL migration entries (they're historical data)
      //   In this case, query ALL migration entries for the year, regardless of pay_date (some might not have it set)
      // - If stored YTD has data: Query migration entries since last update
      let migrationEntries = [];
      
      if (!hasStoredData) {
        // When stored YTD is empty, get ALL migration entries (they might not all have pay_date set correctly)
        // We'll filter by date in JavaScript after fetching
        console.log(`[YTD Calculation] Querying ALL migration entries (stored YTD is empty - will filter by date after fetch)`);
        console.log(`[YTD Calculation] Query params: userId=${userId}, businessId=${effectiveBusinessId}, is_migration_entry=true`);
        
        const { data: migEntries, error: migError } = await supabase
          .from('hrpayroll_entries')
          .select('*')
          .eq('user_id', userId)
          .eq('business_id', effectiveBusinessId)
          .eq('is_migration_entry', true);
        
        if (migError) {
          console.error('[YTD Calculation] Migration entries query error:', migError);
          migrationEntries = [];
        } else {
          console.log(`[YTD Calculation] Raw migration entries query returned: ${migEntries?.length || 0} entries`);
          
          // Filter by date in JavaScript (handles null pay_date)
          migrationEntries = (migEntries || []).filter(entry => {
            if (!entry.pay_date) {
              // If no pay_date, include it (might be old migration data)
              console.log(`[YTD Calculation] Including migration entry ${entry.id} with NULL pay_date`);
              return true;
            }
            const entryDate = new Date(entry.pay_date);
            const inRange = entryDate >= yearStart && entryDate <= targetDate;
            if (!inRange) {
              console.log(`[YTD Calculation] Excluding migration entry ${entry.id} - pay_date ${entry.pay_date} is outside range ${yearStart.toISOString().split('T')[0]} to ${targetDate.toISOString().split('T')[0]}`);
            }
            return inRange;
          });
          console.log(`[YTD Calculation] Found ${migrationEntries.length} migration entries (from ${migEntries?.length || 0} total) for year ${currentYear}`);
          
          // Debug: Log sample migration entries if found
          if (migrationEntries.length > 0) {
            console.log(`[YTD Calculation] Sample migration entry:`, {
              id: migrationEntries[0].id,
              pay_date: migrationEntries[0].pay_date,
              gross_pay: migrationEntries[0].gross_pay,
              is_migration_entry: migrationEntries[0].is_migration_entry
            });
          }
        }
      } else {
        // When stored YTD has data, only get migration entries since last update
        // CRITICAL: Migration entries might have NULL pay_date, so we need to handle that
        console.log(`[YTD Calculation] Querying migration entries from ${calculateFromDate.toISOString().split('T')[0]} to ${targetDate.toISOString().split('T')[0]}`);
        
        // Query ALL migration entries first (because some might have NULL pay_date)
        const { data: migEntries, error: migError } = await supabase
          .from('hrpayroll_entries')
          .select('*')
          .eq('user_id', userId)
          .eq('business_id', effectiveBusinessId)
          .eq('is_migration_entry', true);
        
        if (migError) {
          console.error('[YTD Calculation] Migration entries query error:', migError);
          migrationEntries = [];
        } else {
          // Filter by date in JavaScript (handles NULL pay_date)
          // Include entries with NULL pay_date OR entries within the date range
          migrationEntries = (migEntries || []).filter(entry => {
            if (!entry.pay_date) {
              // If no pay_date, include it (migration data might not have dates set)
              // But only if we're calculating from year start (meaning stored YTD might be incomplete)
              return calculateFromDate <= yearStart;
            }
            const entryDate = new Date(entry.pay_date);
            return entryDate >= calculateFromDate && entryDate <= targetDate;
          });
          console.log(`[YTD Calculation] Found ${migrationEntries.length} migration entries since last update (from ${migEntries?.length || 0} total)`);
        }
      }
      
      if (migrationEntries.length > 0) {
        console.log(`[YTD Calculation] ✅ Including ${migrationEntries.length} migration entries in YTD calculation`);
      } else {
        console.log(`[YTD Calculation] ⚠️ No migration entries found - this might be expected if migration data was already stored in hrpayroll_ytd_data`);
      }
      
      // Combine regular and migration entries
      const recentEntries = [
        ...(regularEntries || []),
        ...(migrationEntries || [])
      ];
      
      if (error) {
        console.error('[YTD Calculation] Query error:', error);
        throw error;
      }

      console.log(`[YTD Calculation] Found ${recentEntries?.length || 0} new payroll entries since last update`);

      // Get employee wage info separately to avoid complex joins
      // FIXED: Remove hourly_wage (doesn't exist), only query wage
      const { data: employeeData, error: empError } = await supabase
        .from('user_roles')
        .select(`
          users!inner (
            id,
            wage
          )
        `)
        .eq('user_id', userId)
        .eq('business_id', effectiveBusinessId)
        .eq('active', true)
        .maybeSingle();

      if (empError) {
        console.warn('Could not get employee wage data:', empError);
      }

      // Use wage from user_roles query, or try business_users as fallback
      let employeeWage = parseFloat(employeeData?.users?.wage || 0);
      
      // Fallback: try business_users table if user_roles doesn't have wage
      if (!employeeWage) {
        const { data: buData } = await supabase
          .from('business_users')
          .select('users!inner(wage)')
          .eq('user_id', userId)
          .eq('business_id', effectiveBusinessId)
          .maybeSingle();
        
        employeeWage = parseFloat(buData?.users?.wage || 0);
      }

      // ORIGINAL WORKING LOGIC: Start with stored YTD totals, add recent entries on top
      // This preserves migration data and historical YTD that's already calculated
      // BUT: If stored YTD is empty, start from zeros and calculate from ALL entries
      const ytdTotals = hasStoredData ? {
        regular_hours: parseFloat(storedYTD.regular_hours || 0),
        overtime_hours: parseFloat(storedYTD.overtime_hours || 0),
        lieu_hours: parseFloat(storedYTD.lieu_hours || 0),
        stat_hours: parseFloat(storedYTD.stat_hours || 0),
        holiday_hours: parseFloat(storedYTD.holiday_hours || 0),
        hours_worked: parseFloat(storedYTD.hours_worked || 0),
        regular_income: parseFloat(storedYTD.regular_income || 0),
        overtime_income: parseFloat(storedYTD.overtime_income || 0),
        lieu_income: parseFloat(storedYTD.lieu_income || 0),
        vacation_pay: parseFloat(storedYTD.vacation_pay || 0),
        shift_premiums: parseFloat(storedYTD.shift_premiums || 0),
        stat_earnings: parseFloat(storedYTD.stat_earnings || 0),
        holiday_earnings: parseFloat(storedYTD.holiday_earnings || 0),
        bonus: parseFloat(storedYTD.bonus || 0),
        federal_tax: parseFloat(storedYTD.federal_tax || 0),
        provincial_tax: parseFloat(storedYTD.provincial_tax || 0),
        cpp_deduction: parseFloat(storedYTD.cpp_deduction || 0),
        ei_deduction: parseFloat(storedYTD.ei_deduction || 0),
        additional_tax: parseFloat(storedYTD.additional_tax || 0),
        gross_pay: parseFloat(storedYTD.gross_pay || 0),
        net_pay: parseFloat(storedYTD.net_pay || 0)
      } : {
        regular_hours: 0,
        overtime_hours: 0,
        lieu_hours: 0,
        stat_hours: 0,
        holiday_hours: 0,
        hours_worked: 0,
        regular_income: 0,
        overtime_income: 0,
        lieu_income: 0,
        vacation_pay: 0,
        shift_premiums: 0,
        stat_earnings: 0,
        holiday_earnings: 0,
        bonus: 0,
        federal_tax: 0,
        provincial_tax: 0,
        cpp_deduction: 0,
        ei_deduction: 0,
        additional_tax: 0,
        gross_pay: 0,
        net_pay: 0
      };

      console.log(`[YTD Calculation] Found ${recentEntries?.length || 0} total entries to process (${regularEntries?.length || 0} regular, ${migrationEntries?.length || 0} migration)`);

      // If no new entries found, return stored YTD (which includes migration data)
      // BUT: If stored YTD is empty and we have no entries, something is wrong
      if (!recentEntries || recentEntries.length === 0) {
        if (!hasStoredData) {
          console.warn(`[YTD Calculation] No entries found and stored YTD is empty for user ${userId}. This might indicate missing migration data.`);
        }
        console.log('[YTD Calculation] No new entries - returning stored YTD totals');
        return {
          ...ytdTotals,
          user_id: userId,
          business_id: effectiveBusinessId,
          tax_year: currentYear,
          calculation_date: targetDate.toISOString(),
          entries_included: 0,
          last_stored_update: storedYTD.last_updated,
          is_current: true
        };
      }

      // Add recent entries to stored YTD totals (preserves migration data)
      recentEntries.forEach(entry => {
        // Hours
        const regularHours = parseFloat(entry.regular_hours || 0);
        const overtimeHours = parseFloat(entry.overtime_hours || 0);
        const lieuHours = parseFloat(entry.lieu_hours || 0);
        
        ytdTotals.regular_hours += regularHours;
        ytdTotals.overtime_hours += overtimeHours;
        ytdTotals.lieu_hours += lieuHours;
        ytdTotals.hours_worked += regularHours + overtimeHours + lieuHours;
        
        // FIXED: Only calculate earnings from wage if we have hourly wage
        if (employeeWage > 0) {
          ytdTotals.regular_income += regularHours * employeeWage;
          ytdTotals.overtime_income += overtimeHours * employeeWage * 1.5;
          ytdTotals.lieu_income += lieuHours * employeeWage;
        }
        
        // Calculate premium pay from JSONB premiums field
        let entryPremiumTotal = 0;
        try {
          const premiums = typeof entry.premiums === 'string' ?
            JSON.parse(entry.premiums) : (entry.premiums || {});
          
          Object.values(premiums).forEach(premium => {
            if (premium.total_pay) {
              entryPremiumTotal += parseFloat(premium.total_pay);
            }
          });
        } catch (e) {
          console.warn('Error parsing premiums for YTD:', e);
        }
        
        ytdTotals.shift_premiums += entryPremiumTotal;
        
        // Tax deductions and totals from payroll entry
        ytdTotals.vacation_pay += parseFloat(entry.vacation_pay || 0);
        ytdTotals.gross_pay += parseFloat(entry.gross_pay || 0);
        ytdTotals.federal_tax += parseFloat(entry.federal_tax || 0);
        ytdTotals.provincial_tax += parseFloat(entry.provincial_tax || 0);
        ytdTotals.ei_deduction += parseFloat(entry.ei_deduction || 0);
        ytdTotals.cpp_deduction += parseFloat(entry.cpp_deduction || 0);
        ytdTotals.additional_tax += parseFloat(entry.additional_tax || 0);
        ytdTotals.net_pay += parseFloat(entry.net_pay || 0);
      });

      const result = {
        ...ytdTotals,
        user_id: userId,
        business_id: effectiveBusinessId,
        tax_year: currentYear,
        calculation_date: targetDate.toISOString(),
        entries_included: recentEntries.length,
        last_stored_update: storedYTD.last_updated,
        is_current: recentEntries.length === 0
      };

      console.log('[YTD Calculation] Final YTD totals:', {
        gross_pay: result.gross_pay,
        net_pay: result.net_pay,
        federal_tax: result.federal_tax,
        entries_included: result.entries_included
      });

      return result;

    } catch (error) {
      console.error('Error calculating employee YTD:', error);
      const effectiveBusinessId = businessId || authSelectedBusinessId;
      await logSecurityEvent('ytd_calculation_error', {
        business_id: effectiveBusinessId,
        user_id: userId,
        error: error.message
      }, 'high');
      return null;
    }
  }, [businessId, authSelectedBusinessId, ytdData, logSecurityEvent]);

  /**
   * Update YTD totals after a payroll run is finalized
   */
  const updateYTDAfterPayroll = useCallback(async (payrollRunId) => {
    if (!businessId) return;

    try {
      const rateLimitCheck = await checkRateLimit('ytd_update_after_payroll', payrollRunId);
      if (!rateLimitCheck.allowed) {
        throw new Error('Rate limit exceeded for YTD updates');
      }

      await recordAction('ytd_update_after_payroll', payrollRunId, true);
      
      await logSecurityEvent('ytd_automatic_update_started', {
        business_id: businessId,
        payroll_run_id: payrollRunId
      }, 'medium');

      // Get all entries from this payroll run
      const { data: entries, error } = await supabase
        .from('hrpayroll_entries')
        .select(`
          *,
          hrpayroll_runs!inner (
            pay_date,
            business_id
          )
        `)
        .eq('payroll_run_id', payrollRunId);

      if (error) throw error;

      const currentYear = new Date().getFullYear();
      const updatedEmployees = [];

      // Process each employee in this payroll run
      for (const entry of entries) {
        try {
          const currentYTD = await calculateEmployeeYTD(entry.user_id);
          
          if (!currentYTD) {
            console.warn(`Could not calculate YTD for employee ${entry.user_id}`);
            continue;
          }

          const ytdRecord = {
            user_id: entry.user_id,
            business_id: businessId,
            tax_year: currentYear,
            regular_hours: currentYTD.regular_hours,
            overtime_hours: currentYTD.overtime_hours,
            lieu_hours: currentYTD.lieu_hours,
            stat_hours: currentYTD.stat_hours,
            holiday_hours: currentYTD.holiday_hours,
            hours_worked: currentYTD.hours_worked,
            regular_income: currentYTD.regular_income,
            overtime_income: currentYTD.overtime_income,
            lieu_income: currentYTD.lieu_income,
            vacation_pay: currentYTD.vacation_pay,
            shift_premiums: currentYTD.shift_premiums,
            stat_earnings: currentYTD.stat_earnings,
            holiday_earnings: currentYTD.holiday_earnings,
            bonus: currentYTD.bonus,
            federal_tax: currentYTD.federal_tax,
            provincial_tax: currentYTD.provincial_tax,
            cpp_deduction: currentYTD.cpp_deduction,
            ei_deduction: currentYTD.ei_deduction,
            additional_tax: currentYTD.additional_tax,
            gross_pay: currentYTD.gross_pay,
            net_pay: currentYTD.net_pay,
            last_updated: new Date().toISOString(),
            last_payroll_run_id: payrollRunId
          };

          const { error: upsertError } = await supabase
            .from('hrpayroll_ytd_data')
            .upsert(ytdRecord, { 
              onConflict: 'user_id,business_id,tax_year',
              ignoreDuplicates: false 
            });

          if (upsertError) {
            console.error(`Error upserting YTD for employee ${entry.user_id}:`, upsertError);
            continue;
          }

          updatedEmployees.push(entry.user_id);

        } catch (employeeError) {
          console.error(`Error processing YTD for employee ${entry.user_id}:`, employeeError);
        }
      }

      // Reload YTD data to reflect changes
      await loadYTDData(businessId);

      return {
        success: true,
        employeesUpdated: updatedEmployees.length,
        updatedEmployeeIds: updatedEmployees
      };

    } catch (error) {
      console.error('Error updating YTD after payroll:', error);
      await recordAction('ytd_update_after_payroll', payrollRunId, false);
      throw error;
    }
  }, [businessId, calculateEmployeeYTD, checkRateLimit, recordAction, logSecurityEvent]);

  /**
   * Manual YTD entry/correction
   */
  const updateManualYTD = useCallback(async (userId, ytdDataUpdate, reason = 'Manual entry') => {
    if (!businessId) return;

    try {
      const rateLimitCheck = await checkRateLimit('manual_ytd_update', userId);
      if (!rateLimitCheck.allowed) {
        throw new Error('Rate limit exceeded for manual YTD updates');
      }

      await recordAction('manual_ytd_update', userId, true);
      
      const currentYear = new Date().getFullYear();

      // Validate YTD data
      const validatedData = {};
      const allowedFields = [
        'regular_hours', 'overtime_hours', 'lieu_hours', 'stat_hours', 'holiday_hours',
        'hours_worked', 'regular_income', 'overtime_income', 'lieu_income',
        'vacation_pay', 'shift_premiums', 'stat_earnings', 'holiday_earnings',
        'bonus', 'federal_tax', 'provincial_tax', 'cpp_deduction', 
        'ei_deduction', 'additional_tax', 'gross_pay', 'net_pay'
      ];

      allowedFields.forEach(field => {
        if (ytdDataUpdate[field] !== undefined) {
          const value = parseFloat(ytdDataUpdate[field]);
          if (!isNaN(value) && value >= 0) {
            validatedData[field] = value;
          }
        }
      });

      if (Object.keys(validatedData).length === 0) {
        throw new Error('No valid YTD data provided');
      }

      const ytdRecord = {
        user_id: userId,
        business_id: businessId,
        tax_year: currentYear,
        ...validatedData,
        last_updated: new Date().toISOString(),
        manual_entry: true,
        manual_entry_reason: reason,
        manual_entry_by: authUser?.id
      };

      const { data, error } = await supabase
        .from('hrpayroll_ytd_data')
        .upsert(ytdRecord, { 
          onConflict: 'user_id,business_id,tax_year',
          ignoreDuplicates: false 
        })
        .select()
        .single();

      if (error) throw error;

      // Reload YTD data
      await loadYTDData(businessId);

      return {
        success: true,
        updatedRecord: data,
        fieldsUpdated: Object.keys(validatedData)
      };

    } catch (error) {
      console.error('Error updating manual YTD:', error);
      await recordAction('manual_ytd_update', userId, false);
      throw error;
    }
  }, [businessId, authUser, checkRateLimit, recordAction]);

  /**
   * Validate YTD data integrity
   */
  const validateYTDIntegrity = useCallback(async (userId = null) => {
    if (!businessId) return { isValid: false, errors: ['No business ID provided'] };

    try {
      const validation = {
        isValid: true,
        errors: [],
        warnings: [],
        checkedEmployees: 0
      };

      const employeesToCheck = userId ? [userId] : Object.keys(ytdData);

      for (const empId of employeesToCheck) {
        const storedYTD = ytdData[empId];
        const calculatedYTD = await calculateEmployeeYTD(empId);

        if (!storedYTD || !calculatedYTD) {
          validation.warnings.push(`Missing YTD data for employee ${empId}`);
          continue;
        }

        // Check for significant discrepancies
        const discrepancyThreshold = 0.50;
        const fields = ['gross_pay', 'federal_tax', 'provincial_tax', 'cpp_deduction', 'ei_deduction', 'net_pay'];

        fields.forEach(field => {
          const stored = parseFloat(storedYTD[field] || 0);
          const calculated = parseFloat(calculatedYTD[field] || 0);
          const difference = Math.abs(stored - calculated);

          if (difference > discrepancyThreshold) {
            validation.errors.push(
              `Employee ${empId} ${field}: Stored=${stored.toFixed(2)}, Calculated=${calculated.toFixed(2)}, Difference=${difference.toFixed(2)}`
            );
            validation.isValid = false;
          }
        });

        validation.checkedEmployees++;
      }

      return validation;

    } catch (error) {
      console.error('Error validating YTD integrity:', error);
      return {
        isValid: false,
        errors: [`Validation failed: ${error.message}`],
        warnings: [],
        checkedEmployees: 0
      };
    }
  }, [businessId, ytdData, calculateEmployeeYTD]);

  // FIXED: Simple format function without circular dependencies
  const formatYTDAmount = useCallback((amount, precision = 2) => {
    return Number(amount || 0).toFixed(precision);
  }, []);

  return {
    // Data state
    ytdData,
    loading,
    error,
    lastCalculation,
    
    // Core calculation functions
    calculateEmployeeYTD,
    
    // Automatic update functions
    updateYTDAfterPayroll,
    
    // Manual entry functions
    updateManualYTD,
    
    // Utility functions
    formatYTDAmount,
    validateYTDIntegrity,
    
    // Data management
    refreshYTDData: () => loadYTDData(businessId),
    
    // Helper functions for integration
    getEmployeeYTD: (userId, upToDate = null) => calculateEmployeeYTD(userId, upToDate),
    hasYTDData: (userId) => !!ytdData[userId]
  };
};

export default useYTDCalculations;