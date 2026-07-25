// If no wage changes found, return single period with current wage
      if (!wageChanges || wageChanges.length === 0) {
        console.log(`No wage changes found for employee ${employeeId}, using current wage`);
        return [{
          wage: currentWage,
          startDate: startDate,
          endDate: endDate,
          daysInPeriod: this.calculateDaysBetween(startDate, endDate)
        }];
      }// utils/WageHistory.js - Utility for handling wage changes across pay periods
import { supabase } from '../supabaseClient';

/**
 * WageHistory - Handles wage changes and splits pay periods when wages change
 */
export class WageHistory {
  constructor(businessId) {
    this.businessId = businessId;
  }

  /**
   * Get wage periods for an employee within a date range
   * Returns an array of wage periods if the wage changed during the range
   * 
   * @param {string} employeeId - Employee's user ID
   * @param {string} startDate - Period start date (YYYY-MM-DD)
   * @param {string} endDate - Period end date (YYYY-MM-DD)
   * @returns {Promise<Array>} Array of wage periods with wages and date ranges
   */
  async getWagePeriodsInRange(employeeId, startDate, endDate) {
    if (!employeeId || !startDate || !endDate) {
      console.warn('Missing required parameters for getWagePeriodsInRange');
      return [];
    }

    try {
      // Get employee's current wage
      const { data: employee, error: employeeError } = await supabase
        .from('users')
        .select('wage')
        .eq('id', employeeId)
        .single();

      if (employeeError) throw employeeError;

      const currentWage = parseFloat(employee?.wage || 0);

      // FIXED: Query hrpayroll_wage_history table instead of audit_logs
      const { data: wageChanges, error: wageError } = await supabase
        .from('hrpayroll_wage_history')
        .select('*')
        .eq('business_id', this.businessId)
        .eq('user_id', employeeId)
        .lte('effective_date', endDate)
        .order('effective_date', { ascending: true });

      if (wageError) {
        console.error('Error fetching wage changes:', wageError);
        // Return single period with current wage
        return [{
          wage: currentWage,
          startDate: startDate,
          endDate: endDate,
          daysInPeriod: this.calculateDaysBetween(startDate, endDate)
        }];
      }

      // If no wage changes in this period, return single period
      if (!wageChanges || wageChanges.length === 0) {
        return [{
          wage: currentWage,
          startDate: startDate,
          endDate: endDate,
          daysInPeriod: this.calculateDaysBetween(startDate, endDate)
        }];
      }

      // Build periods array from wage changes
      const periods = [];
      let periodStart = startDate;

      // Sort changes by effective date
      const sortedChanges = wageChanges
        .map(change => ({
          effectiveDate: change.details.effective_date,
          previousWage: parseFloat(change.details.previous_wage || 0),
          newWage: parseFloat(change.details.new_wage || 0)
        }))
        .sort((a, b) => new Date(a.effectiveDate) - new Date(b.effectiveDate));

      // Create periods between wage changes
      sortedChanges.forEach((change, index) => {
        const changeDate = change.effectiveDate;
        
        // Add period before this wage change (if it's after period start)
        if (changeDate > periodStart) {
          const dayBefore = this.subtractDays(changeDate, 1);
          periods.push({
            wage: change.previousWage,
            startDate: periodStart,
            endDate: dayBefore,
            daysInPeriod: this.calculateDaysBetween(periodStart, dayBefore)
          });
          periodStart = changeDate;
        }
      });

      // Add final period from last change to end date
      if (periodStart <= endDate) {
        periods.push({
          wage: currentWage,
          startDate: periodStart,
          endDate: endDate,
          daysInPeriod: this.calculateDaysBetween(periodStart, endDate)
        });
      }

      console.log(`Found ${periods.length} wage period(s) for employee ${employeeId}`);
      return periods;

    } catch (error) {
      console.error('Error in getWagePeriodsInRange:', error);
      // Fallback: return single period with current wage
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

  /**
   * Calculate days between two dates (inclusive)
   */
  calculateDaysBetween(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays + 1; // +1 to include both start and end dates
  }

  /**
   * Subtract days from a date
   */
  subtractDays(dateString, days) {
    const date = new Date(dateString);
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  /**
   * Add days to a date
   */
  addDays(dateString, days) {
    const date = new Date(dateString);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }

  /**
   * Get all wage changes for an employee (for history display)
   */
  async getWageChangeHistory(employeeId) {
    try {
      const { data: wageChanges, error } = await supabase
        .from('audit_logs')
        .select(`
          id,
          details,
          timestamp,
          user_id,
          users(first_name, last_name, full_name)
        `)
        .eq('business_id', this.businessId)
        .eq('event_type', 'wage_change')
        .eq('details->>employee_id', employeeId)
        .order('timestamp', { ascending: false });

      if (error) throw error;

      return wageChanges || [];
    } catch (error) {
      console.error('Error fetching wage change history:', error);
      return [];
    }
  }
}

export default WageHistory;