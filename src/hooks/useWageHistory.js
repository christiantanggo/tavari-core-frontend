// hooks/useWageHistory.js - Helper for retrieving wage at specific dates
import { useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useSecurityContext } from '../Security';

/**
 * Hook for managing wage history and retrieving historical wage rates
 * Integrates with hrpayroll_wage_history table
 */
export const useWageHistory = (businessId) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { logSecurityEvent } = useSecurityContext({
    componentName: 'useWageHistory',
    sensitiveComponent: true,
    enableAuditLogging: true
  });

  /**
   * Get employee's wage rate on a specific date
   * Checks wage history for changes before the given date
   * 
   * @param {string} employeeId - Employee user ID
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {Promise<number>} Wage rate on that date
   */
  const getWageOnDate = useCallback(async (employeeId, date) => {
    if (!employeeId || !date) {
      console.warn('getWageOnDate: Missing employeeId or date');
      return null;
    }

    try {
      // Get employee's current wage as fallback
      const { data: employee, error: empError } = await supabase
        .from('users')
        .select('wage')
        .eq('id', employeeId)
        .single();

      if (empError) throw empError;

      const currentWage = parseFloat(employee?.wage || 0);

      // Get wage history records effective on or before this date
      const { data: wageHistory, error: historyError } = await supabase
        .from('hrpayroll_wage_history')
        .select('*')
        .eq('user_id', employeeId)
        .eq('business_id', businessId)
        .lte('effective_date', date)
        .order('effective_date', { ascending: false })
        .limit(1);

      if (historyError) throw historyError;

      // If we found a wage change record before this date, use it
      if (wageHistory && wageHistory.length > 0) {
        return parseFloat(wageHistory[0].new_wage);
      }

      // Otherwise, use current wage
      return currentWage;

    } catch (err) {
      console.error('Error getting wage on date:', err);
      setError(err.message);
      return null;
    }
  }, [businessId]);

  /**
   * Get all wage changes for an employee during a pay period
   * Returns an array of wage periods with start/end dates
   * 
   * @param {string} employeeId - Employee user ID
   * @param {string} periodStart - Pay period start date (YYYY-MM-DD)
   * @param {string} periodEnd - Pay period end date (YYYY-MM-DD)
   * @returns {Promise<Array>} Array of wage periods: [{startDate, endDate, wage}, ...]
   */
  const getWagePeriodsInRange = useCallback(async (employeeId, periodStart, periodEnd) => {
    if (!employeeId || !periodStart || !periodEnd) {
      console.warn('getWagePeriodsInRange: Missing required parameters');
      return [];
    }

    try {
      setLoading(true);

      // Get employee's current wage
      const { data: employee, error: empError } = await supabase
        .from('users')
        .select('wage')
        .eq('id', employeeId)
        .single();

      if (empError) throw empError;

      const currentWage = parseFloat(employee?.wage || 0);

      // Get all wage changes that affect this pay period
      // This includes:
      // 1. Changes before the period (to get starting wage)
      // 2. Changes during the period (wage splits)
      const { data: wageHistory, error: historyError } = await supabase
        .from('hrpayroll_wage_history')
        .select('*')
        .eq('user_id', employeeId)
        .eq('business_id', businessId)
        .lte('effective_date', periodEnd)
        .order('effective_date', { ascending: true });

      if (historyError) throw historyError;

      // Build wage periods
      const periods = [];
      let currentPeriodStart = periodStart;

      if (!wageHistory || wageHistory.length === 0) {
        // No wage changes - single period with current wage
        periods.push({
          startDate: periodStart,
          endDate: periodEnd,
          wage: currentWage,
          daysInPeriod: calculateDaysBetween(periodStart, periodEnd)
        });
      } else {
        // Filter changes that are within or affect the pay period
        const relevantChanges = wageHistory.filter(change => 
          change.effective_date >= periodStart && change.effective_date <= periodEnd
        );

        if (relevantChanges.length === 0) {
          // Changes exist but none during this period
          // Use the most recent wage before period start
          const previousWage = wageHistory[wageHistory.length - 1];
          periods.push({
            startDate: periodStart,
            endDate: periodEnd,
            wage: parseFloat(previousWage.new_wage),
            daysInPeriod: calculateDaysBetween(periodStart, periodEnd)
          });
        } else {
          // Get starting wage (wage before first change in period)
          const changesBeforePeriod = wageHistory.filter(c => c.effective_date < periodStart);
          let startingWage = currentWage;
          
          if (changesBeforePeriod.length > 0) {
            const lastChangeBefore = changesBeforePeriod[changesBeforePeriod.length - 1];
            startingWage = parseFloat(lastChangeBefore.new_wage);
          }

          // Build periods with wage changes
          for (let i = 0; i < relevantChanges.length; i++) {
            const change = relevantChanges[i];
            const changeDate = change.effective_date;

            // Add period before this change (if not the first change)
            if (i === 0 && changeDate > periodStart) {
              // Period from start to day before change
              const dayBeforeChange = subtractDays(changeDate, 1);
              periods.push({
                startDate: currentPeriodStart,
                endDate: dayBeforeChange,
                wage: startingWage,
                daysInPeriod: calculateDaysBetween(currentPeriodStart, dayBeforeChange)
              });
            } else if (i > 0) {
              // Period from previous change to day before this change
              const dayBeforeChange = subtractDays(changeDate, 1);
              const previousWage = parseFloat(relevantChanges[i - 1].new_wage);
              periods.push({
                startDate: currentPeriodStart,
                endDate: dayBeforeChange,
                wage: previousWage,
                daysInPeriod: calculateDaysBetween(currentPeriodStart, dayBeforeChange)
              });
            }

            currentPeriodStart = changeDate;
          }

          // Add final period from last change to end
          const lastChange = relevantChanges[relevantChanges.length - 1];
          periods.push({
            startDate: lastChange.effective_date,
            endDate: periodEnd,
            wage: parseFloat(lastChange.new_wage),
            daysInPeriod: calculateDaysBetween(lastChange.effective_date, periodEnd)
          });
        }
      }

      await logSecurityEvent('wage_periods_calculated', {
        business_id: businessId,
        employee_id: employeeId,
        period_start: periodStart,
        period_end: periodEnd,
        wage_periods_count: periods.length
      }, 'low');

      return periods;

    } catch (err) {
      console.error('Error getting wage periods:', err);
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [businessId, logSecurityEvent]);

  /**
   * Split hours proportionally across wage periods
   * Used when hours need to be distributed across multiple wage rates
   * 
   * @param {number} totalHours - Total hours to split
   * @param {Array} wagePeriods - Array of wage periods from getWagePeriodsInRange
   * @returns {Array} Array of {hours, wage, pay} for each period
   */
  const splitHoursAcrossPeriods = useCallback((totalHours, wagePeriods) => {
    if (!wagePeriods || wagePeriods.length === 0) {
      return [];
    }

    if (wagePeriods.length === 1) {
      // No split needed
      return [{
        hours: totalHours,
        wage: wagePeriods[0].wage,
        pay: totalHours * wagePeriods[0].wage,
        startDate: wagePeriods[0].startDate,
        endDate: wagePeriods[0].endDate
      }];
    }

    // Calculate total days in all periods
    const totalDays = wagePeriods.reduce((sum, period) => sum + period.daysInPeriod, 0);

    // Split hours proportionally by days
    const splits = wagePeriods.map(period => {
      const proportion = period.daysInPeriod / totalDays;
      const hours = totalHours * proportion;
      const pay = hours * period.wage;

      return {
        hours: Math.round(hours * 100) / 100, // Round to 2 decimals
        wage: period.wage,
        pay: Math.round(pay * 100) / 100,
        startDate: period.startDate,
        endDate: period.endDate,
        daysInPeriod: period.daysInPeriod
      };
    });

    return splits;
  }, []);

  return {
    loading,
    error,
    getWageOnDate,
    getWagePeriodsInRange,
    splitHoursAcrossPeriods
  };
};

// Helper function to calculate days between dates
function calculateDaysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end
  return diffDays;
}

// Helper function to subtract days from a date
function subtractDays(dateString, days) {
  const date = new Date(dateString);
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

export default useWageHistory;