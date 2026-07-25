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
  const calculateEmployeeYTD = useCallback(async (userId, upToDate = null, businessIdOverride = null, businessTimezone = null, options = null) => {
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
    
    // Get business timezone - use passed timezone or get from businessData
    const effectiveTimezone = businessTimezone || businessData?.timezone || 'America/Toronto';
    
    console.log('[YTD Calculation] Using business ID:', effectiveBusinessId, {
      source: businessIdOverride ? 'override' : (businessId ? 'parameter' : 'auth'),
      userId,
      upToDate,
      timezone: effectiveTimezone
    });

    try {
      // CRITICAL FIX: Handle date input correctly - upToDate might be a date string or Date object
      // For YTD, we use pay_period_end (not pay_date) to include all work done up to the end of the pay period
      // Parse the date in the business timezone to ensure consistent comparisons
      let targetDate;
      if (upToDate) {
        if (upToDate instanceof Date) {
          targetDate = upToDate;
        } else if (typeof upToDate === 'string') {
          // If it's a date string (YYYY-MM-DD), parse it in business timezone
          // Create a date at noon in business timezone to avoid timezone shift issues
          const dateStr = upToDate.split('T')[0]; // Get just the date part
          const [year, month, day] = dateStr.split('-').map(Number);
          // Create date at noon in business timezone (avoids day-shift issues)
          targetDate = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00`);
        } else {
          targetDate = new Date(upToDate);
        }
      } else {
        targetDate = new Date();
      }
      
      // CRITICAL: Normalize the date using business timezone
      // Extract year, month, day in business timezone to ensure consistent date comparisons
      const businessDateParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: effectiveTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(targetDate);
      
      const targetYear = parseInt(businessDateParts.find(p => p.type === 'year').value);
      const targetMonth = parseInt(businessDateParts.find(p => p.type === 'month').value) - 1; // Month is 0-indexed
      const targetDay = parseInt(businessDateParts.find(p => p.type === 'day').value);
      
      // Create normalized date at end of day in business timezone
      // Use UTC to create the date, but interpret it as business timezone
      const normalizedTargetDate = new Date(Date.UTC(targetYear, targetMonth, targetDay, 23, 59, 59, 999));
      
      // Determine tax year based on the normalized date
      // If viewing a pay statement from early January (Jan 1-15), check if it's part of the previous year's final payroll
      // For now, use the year of the target date as the tax year
      const taxYear = targetYear;
      const yearStart = new Date(Date.UTC(taxYear, 0, 1, 0, 0, 0, 0)); // January 1 of tax year at midnight UTC
      
      console.log(`[YTD Calculation] Tax year: ${taxYear}, Year start: ${yearStart.toISOString().split('T')[0]}, Target date (normalized): ${normalizedTargetDate.toISOString().split('T')[0]}`);

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
      // Normalize lastUpdated to business timezone for consistent comparisons
      const lastUpdatedRaw = new Date(storedYTD.last_updated || yearStart);
      const lastUpdatedParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: effectiveTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(lastUpdatedRaw);
      const lastUpdatedYear = parseInt(lastUpdatedParts.find(p => p.type === 'year').value);
      const lastUpdatedMonth = parseInt(lastUpdatedParts.find(p => p.type === 'month').value) - 1;
      const lastUpdatedDay = parseInt(lastUpdatedParts.find(p => p.type === 'day').value);
      const lastUpdated = new Date(Date.UTC(lastUpdatedYear, lastUpdatedMonth, lastUpdatedDay, 0, 0, 0, 0));
      
      // CRITICAL: If stored YTD is empty (all zeros), it means no data was stored yet
      // In this case, we need to calculate from year start, not from lastUpdated
      // Also check if stored YTD seems incomplete (e.g., only has current period data)
      const hasStoredData = storedYTD.gross_pay > 0 || storedYTD.net_pay > 0 || storedYTD.federal_tax > 0;
      
      // ✅ CRITICAL: Check if stored YTD is from a different tax year
      // If stored YTD's tax_year doesn't match the target tax year, ignore it and calculate from year start
      const storedYTDTaxYear = storedYTD.tax_year;
      const isWrongTaxYear = hasStoredData && storedYTDTaxYear && storedYTDTaxYear !== taxYear;
      
      // ADDITIONAL CHECK: If stored YTD exists but seems incomplete or outdated, recalculate from year start
      // This handles cases where:
      // 1. YTD was incorrectly stored with only partial data (gross_pay suspiciously low)
      // 2. Stored YTD is very outdated (last_updated is more than 30 days before target date)
      // 3. Stored YTD doesn't have a last_payroll_run_id (might be manually entered or incomplete)
      // 4. Stored YTD is from a different tax year (e.g., 2025 data when calculating for 2026)
      const storedYTDDate = storedYTD.last_updated ? new Date(storedYTD.last_updated) : null;
      const daysSinceUpdate = storedYTDDate ? Math.floor((normalizedTargetDate - storedYTDDate) / (1000 * 60 * 60 * 24)) : 999;
      const isOutdated = daysSinceUpdate > 30; // More than 30 days old
      const seemsIncomplete = storedYTD.gross_pay < 1000 && hasStoredData; // Suspiciously low
      const missingPayrollRunId = hasStoredData && !storedYTD.last_payroll_run_id; // No payroll run ID suggests manual entry
      
      // ✅ Also check if lastUpdated is before yearStart (meaning stored YTD is from previous year)
      const isFromPreviousYear = hasStoredData && lastUpdated < yearStart;
      
      const storedYTDSeemsIncomplete = hasStoredData && (isWrongTaxYear || isFromPreviousYear || isOutdated || seemsIncomplete || missingPayrollRunId);
      
      if (isWrongTaxYear || isFromPreviousYear) {
        console.warn(`[YTD Calculation] Stored YTD is from different tax year:`, {
          stored_tax_year: storedYTDTaxYear,
          target_tax_year: taxYear,
          last_updated: storedYTD.last_updated,
          year_start: yearStart.toISOString().split('T')[0],
          action: 'Will recalculate from year start'
        });
      }
      
      if (storedYTDSeemsIncomplete) {
        console.warn(`[YTD Calculation] Stored YTD seems incomplete/outdated:`, {
          gross_pay: storedYTD.gross_pay,
          last_updated: storedYTD.last_updated,
          days_since_update: daysSinceUpdate,
          has_payroll_run_id: !!storedYTD.last_payroll_run_id,
          reason: isOutdated ? 'outdated' : (seemsIncomplete ? 'incomplete' : 'missing_payroll_run_id')
        });
      }
      
      // Pay statements pass excludePayrollRunId: sum all entries for the year through the target date
      // except that run; the statement layer then adds the current entry once.
      const excludePayrollRunId = options?.excludePayrollRunId || null;

      // FIXED: For new employees or when stored YTD is empty, always calculate from year start
      // For existing YTD data, we need to query entries AFTER the last_updated date to avoid double counting
      // Use .gt() (greater than) instead of .gte() to exclude entries that were already counted
      // If stored YTD seems incomplete, recalculate from year start
      const shouldCalculateFromYearStart = !hasStoredData || storedYTDSeemsIncomplete || !!excludePayrollRunId;
      const calculateFromDate = !shouldCalculateFromYearStart && lastUpdated > yearStart ? lastUpdated : yearStart;
      
      // If we have stored data, we need to query entries AFTER last_updated (not including it)
      // This prevents double counting entries that were already included in stored YTD
      const queryFromDate = !shouldCalculateFromYearStart && lastUpdated > yearStart 
        ? new Date(lastUpdated.getTime() + 24 * 60 * 60 * 1000) // Add 1 day to exclude entries on last_updated date
        : calculateFromDate;
      
      if (storedYTDSeemsIncomplete) {
        console.warn(`[YTD Calculation] Stored YTD seems incomplete (gross_pay: ${storedYTD.gross_pay}), recalculating from year start`);
      }
      
      console.log(`[YTD Calculation] Calculating YTD for user ${userId} from ${queryFromDate.toISOString().split('T')[0]} to ${normalizedTargetDate.toISOString().split('T')[0]}`);
      console.log(`[YTD Calculation] Stored YTD last_updated: ${lastUpdated.toISOString().split('T')[0]}`);
      console.log(`[YTD Calculation] Has stored data: ${hasStoredData}, Using stored YTD as base:`, {
        gross_pay: storedYTD.gross_pay,
        net_pay: storedYTD.net_pay,
        federal_tax: storedYTD.federal_tax
      });
      console.log(`[YTD Calculation] Query parameters:`, {
        userId,
        effectiveBusinessId,
        queryFromDate: queryFromDate.toISOString().split('T')[0],
        targetDate: normalizedTargetDate.toISOString().split('T')[0],
        yearStart: yearStart.toISOString().split('T')[0]
      });
      
      // ✅ CRITICAL: Use pay_period_end NOT pay_date for YTD calculations
      // YTD should include all periods from Jan 1 of current year up to and INCLUDING the target pay_period_end
      // Query entries since last update (stored YTD already includes everything before this)
      // If stored YTD is empty, query from year start to get ALL entries including migration
      // FIXED: Use .gt() to exclude entries on the last_updated date to prevent double counting
      let regularQuery = supabase
        .from('hrpayroll_entries')
        .select(`
          *,
          hrpayroll_runs!inner (
            pay_period_end,
            business_id
          )
        `)
        .eq('user_id', userId)
        .eq('hrpayroll_runs.business_id', effectiveBusinessId)
        .gt('hrpayroll_runs.pay_period_end', queryFromDate.toISOString().split('T')[0])
        .lte('hrpayroll_runs.pay_period_end', normalizedTargetDate.toISOString().split('T')[0]);

      if (excludePayrollRunId) {
        regularQuery = regularQuery.neq('payroll_run_id', excludePayrollRunId);
      }

      const { data: regularEntriesRaw, error } = await regularQuery;

      const regularEntries = (regularEntriesRaw || []).filter(
        (e) => !excludePayrollRunId || e.payroll_run_id !== excludePayrollRunId
      );
      
      console.log(`[YTD Calculation] Query returned ${regularEntries?.length || 0} entries`);
      if (regularEntries && regularEntries.length > 0) {
        console.log(`[YTD Calculation] Sample entry dates:`, regularEntries.slice(0, 3).map(e => ({
          id: e.id,
          pay_date: e.hrpayroll_runs?.pay_date,
          gross_pay: e.gross_pay
        })));
      }
      
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
            // Normalize entry date to business timezone for comparison
            const entryDateObj = new Date(entry.pay_date);
            const entryDateParts = new Intl.DateTimeFormat('en-CA', {
              timeZone: effectiveTimezone,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            }).formatToParts(entryDateObj);
            const entryYear = parseInt(entryDateParts.find(p => p.type === 'year').value);
            const entryMonth = parseInt(entryDateParts.find(p => p.type === 'month').value) - 1;
            const entryDay = parseInt(entryDateParts.find(p => p.type === 'day').value);
            const normalizedEntryDate = new Date(Date.UTC(entryYear, entryMonth, entryDay, 0, 0, 0, 0));
            
            const inRange = normalizedEntryDate >= yearStart && normalizedEntryDate <= normalizedTargetDate;
            if (!inRange) {
              console.log(`[YTD Calculation] Excluding migration entry ${entry.id} - pay_date ${entry.pay_date} is outside range ${yearStart.toISOString().split('T')[0]} to ${normalizedTargetDate.toISOString().split('T')[0]}`);
            }
            return inRange;
          });
          console.log(`[YTD Calculation] Found ${migrationEntries.length} migration entries (from ${migEntries?.length || 0} total) for year ${taxYear}`);
          
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
        // When stored YTD has data, we need to check if we're recalculating from year start
        // If stored YTD is incomplete/outdated, we should include ALL migration entries for the tax year
        // Otherwise, only get migration entries since last update
        console.log(`[YTD Calculation] Querying migration entries. Recalculating from year start: ${shouldCalculateFromYearStart}`);
        
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
          if (shouldCalculateFromYearStart) {
            // If recalculating from year start, include ALL migration entries for the tax year
            console.log(`[YTD Calculation] Including ALL migration entries for tax year ${taxYear} (recalculating from year start)`);
            migrationEntries = (migEntries || []).filter(entry => {
              if (!entry.pay_date) {
                // If no pay_date, include it (migration data might not have dates set)
                console.log(`[YTD Calculation] Including migration entry ${entry.id} with NULL pay_date`);
                return true;
              }
              // Normalize entry date to UTC for comparison
              const entryDateObj = new Date(entry.pay_date);
              const entryYear = entryDateObj.getUTCFullYear();
              const entryMonth = entryDateObj.getUTCMonth();
              const entryDay = entryDateObj.getUTCDate();
              const normalizedEntryDate = new Date(Date.UTC(entryYear, entryMonth, entryDay, 0, 0, 0, 0));
              
              const inRange = normalizedEntryDate >= yearStart && normalizedEntryDate <= normalizedTargetDate;
              if (!inRange) {
                console.log(`[YTD Calculation] Excluding migration entry ${entry.id} - pay_date ${entry.pay_date} is outside tax year range`);
              }
              return inRange;
            });
            console.log(`[YTD Calculation] Found ${migrationEntries.length} migration entries for tax year ${taxYear} (from ${migEntries?.length || 0} total)`);
          } else {
            // If using stored YTD as base, only get migration entries since last update
            console.log(`[YTD Calculation] Including migration entries since last update (from ${queryFromDate.toISOString().split('T')[0]} to ${normalizedTargetDate.toISOString().split('T')[0]})`);
            migrationEntries = (migEntries || []).filter(entry => {
              if (!entry.pay_date) {
                // If no pay_date, don't include it when using stored YTD (might cause double counting)
                return false;
              }
              // Normalize entry date to UTC for comparison
              const entryDateObj = new Date(entry.pay_date);
              const entryYear = entryDateObj.getUTCFullYear();
              const entryMonth = entryDateObj.getUTCMonth();
              const entryDay = entryDateObj.getUTCDate();
              const normalizedEntryDate = new Date(Date.UTC(entryYear, entryMonth, entryDay, 0, 0, 0, 0));
              
              // Normalize lastUpdated to UTC for comparison
              const lastUpdatedYear = lastUpdated.getUTCFullYear();
              const lastUpdatedMonth = lastUpdated.getUTCMonth();
              const lastUpdatedDay = lastUpdated.getUTCDate();
              const normalizedLastUpdated = new Date(Date.UTC(lastUpdatedYear, lastUpdatedMonth, lastUpdatedDay, 0, 0, 0, 0));
              
              // Use > instead of >= to exclude entries on the last_updated date (matching regular entries query)
              return normalizedEntryDate > normalizedLastUpdated && normalizedEntryDate <= normalizedTargetDate;
            });
            console.log(`[YTD Calculation] Found ${migrationEntries.length} migration entries since last update (from ${migEntries?.length || 0} total)`);
          }
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
      // If stored YTD seems incomplete, also start from zeros
      // Statement mode (excludePayrollRunId): never use stored row — it may already include this run
      const shouldUseStoredAsBase = !excludePayrollRunId && hasStoredData && !storedYTDSeemsIncomplete;
      console.log(`[YTD Calculation] Using stored YTD as base: ${shouldUseStoredAsBase} (hasStoredData: ${hasStoredData}, seemsIncomplete: ${storedYTDSeemsIncomplete})`);
      
      const ytdTotals = shouldUseStoredAsBase ? {
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
          tax_year: taxYear,
          calculation_date: targetDate.toISOString(),
          entries_included: 0,
          last_stored_update: storedYTD.last_updated,
          is_current: true
        };
      }

      // Add recent entries to stored YTD totals (preserves migration data)
      recentEntries.forEach(entry => {
        // Hours - use actual hours from entry
        const regularHours = parseFloat(entry.regular_hours || 0);
        const overtimeHours = parseFloat(entry.overtime_hours || 0);
        const lieuHours = parseFloat(entry.lieu_hours || 0);
        const statHours = parseFloat(entry.stat_holiday_hours || 0);
        const holidayHours = parseFloat(entry.holiday_pay || 0) > 0 && employeeWage > 0 
          ? (parseFloat(entry.holiday_pay || 0) / employeeWage) 
          : 0;
        
        ytdTotals.regular_hours += regularHours;
        ytdTotals.overtime_hours += overtimeHours;
        ytdTotals.lieu_hours += lieuHours;
        ytdTotals.stat_hours += statHours;
        ytdTotals.holiday_hours += holidayHours;
        ytdTotals.hours_worked += regularHours + overtimeHours + lieuHours + statHours + holidayHours;
        
        // FIXED: Calculate earnings from hours and wage (entries don't have separate income fields)
        // The gross_pay field is the total, but we need to break it down for YTD reporting
        // Calculate earnings from hours * wage to get accurate breakdown
        if (employeeWage > 0) {
          ytdTotals.regular_income += regularHours * employeeWage;
          ytdTotals.overtime_income += overtimeHours * employeeWage * 1.5;
          ytdTotals.lieu_income += lieuHours * employeeWage;
          ytdTotals.stat_earnings += statHours * employeeWage;
        }
        
        // Holiday pay is stored as a dollar amount, not hours
        ytdTotals.holiday_earnings += parseFloat(entry.holiday_pay || 0);
        
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
        
        // Tax deductions and totals from payroll entry (use actual values from entry)
        ytdTotals.vacation_pay += parseFloat(entry.vacation_pay || 0);
        ytdTotals.gross_pay += parseFloat(entry.gross_pay || 0);
        ytdTotals.federal_tax += parseFloat(entry.federal_tax || 0);
        ytdTotals.provincial_tax += parseFloat(entry.provincial_tax || 0) + parseFloat(entry.ontario_health_premium || 0);
        ytdTotals.ei_deduction += parseFloat(entry.ei_deduction || 0);
        ytdTotals.cpp_deduction += parseFloat(entry.cpp_deduction || 0);
        ytdTotals.additional_tax += parseFloat(entry.additional_tax || 0);
        ytdTotals.net_pay += parseFloat(entry.net_pay || 0);
      });

      const result = {
        ...ytdTotals,
        user_id: userId,
        business_id: effectiveBusinessId,
        tax_year: taxYear,
        calculation_date: targetDate.toISOString(),
        entries_included: recentEntries.length,
        last_stored_update: storedYTD.last_updated,
        is_current: recentEntries.length === 0
      };

      console.log('[YTD Calculation] ========== FINAL YTD TOTALS ==========');
      console.log('[YTD Calculation] Entries included:', result.entries_included);
      console.log('[YTD Calculation] Gross Pay:', result.gross_pay);
      console.log('[YTD Calculation] Net Pay:', result.net_pay);
      console.log('[YTD Calculation] Federal Tax:', result.federal_tax);
      console.log('[YTD Calculation] Regular Hours:', result.regular_hours);
      console.log('[YTD Calculation] Total Hours:', result.hours_worked);
      console.log('[YTD Calculation] Vacation Pay:', result.vacation_pay);
      console.log('[YTD Calculation] Holiday Pay:', result.holiday_earnings);
      console.log('[YTD Calculation] ======================================');

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

      if (!entries || entries.length === 0) {
        console.warn(`No entries found for payroll run ${payrollRunId}`);
        return { success: true, employeesUpdated: 0, updatedEmployeeIds: [] };
      }

      // Get the payroll run's pay_date (should be the same for all entries in the run)
      const payrollPayDate = entries[0]?.hrpayroll_runs?.pay_date;
      if (!payrollPayDate) {
        console.error(`Payroll run ${payrollRunId} has no pay_date`);
        throw new Error('Payroll run missing pay_date');
      }

      // FIXED: Set last_updated to the day AFTER the payroll date
      // This ensures that when querying for the next payroll, we don't include entries from this payroll
      const payrollDate = new Date(payrollPayDate);
      const lastUpdatedDate = new Date(payrollDate);
      lastUpdatedDate.setDate(lastUpdatedDate.getDate() + 1); // Day after payroll date
      
      const currentYear = new Date().getFullYear();
      const updatedEmployees = [];

      // Process each employee in this payroll run
      for (const entry of entries) {
        try {
          const currentYTD = await calculateEmployeeYTD(entry.user_id, payrollPayDate);
          
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
            // FIXED: Set last_updated to day after payroll date, not current timestamp
            // This ensures we don't double count entries on the next calculation
            last_updated: lastUpdatedDate.toISOString(),
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