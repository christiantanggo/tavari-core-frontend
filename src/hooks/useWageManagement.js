// hooks/useWageManagement.js
import { useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useSecurityContext } from '../Security';
import { usePOSAuth } from './usePOSAuth';

export const useWageManagement = (businessId) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { logSecurityEvent, recordAction, checkRateLimit } = useSecurityContext({
    componentName: 'useWageManagement',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  const { authUser } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin', 'hr_admin'],
    requireBusiness: true
  });

  /**
   * Add a wage change for an employee
   */
  const addWageChange = useCallback(async (userId, wageData) => {
    const rateLimitCheck = await checkRateLimit('add_wage_change');
    if (!rateLimitCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait before making more wage changes.');
    }

    setLoading(true);
    setError(null);

    try {
      // Get previous wage
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('wage')
        .eq('id', userId)
        .single();

      if (userError) throw userError;

      const previousWage = parseFloat(userData?.wage || 0);
      const newWage = parseFloat(wageData.newWage);

      if (newWage === previousWage) {
        throw new Error('New wage must be different from current wage');
      }

      // Insert wage history
      const { data: wageHistory, error: historyError } = await supabase
        .from('hrpayroll_wage_history')
        .insert({
          user_id: userId,
          business_id: businessId,
          previous_wage: previousWage,
          new_wage: newWage,
          effective_date: wageData.effectiveDate,
          reason: wageData.reason,
          notes: wageData.notes || null,
          change_type: wageData.changeType || 'manual',
          created_by: authUser.id
        })
        .select()
        .single();

      if (historyError) throw historyError;

      await recordAction('wage_change_added', userId, true);
      await logSecurityEvent('wage_change_created', {
        business_id: businessId,
        employee_id: userId,
        previous_wage: previousWage,
        new_wage: newWage,
        effective_date: wageData.effectiveDate,
        change_type: wageData.changeType
      }, 'high');

      return wageHistory;
    } catch (err) {
      setError(err.message);
      await recordAction('wage_change_added', userId, false);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [businessId, authUser, checkRateLimit, recordAction, logSecurityEvent]);

  /**
   * Bulk wage increase for all employees
   */
  const bulkWageIncrease = useCallback(async (increaseData) => {
    const rateLimitCheck = await checkRateLimit('bulk_wage_update');
    if (!rateLimitCheck.allowed) {
      throw new Error('Rate limit exceeded. Please wait before making bulk changes.');
    }

    setLoading(true);
    setError(null);

    try {
      const { increaseType, increaseValue, effectiveDate, reason, employeeIds } = increaseData;

      // Get all employees
      const { data: employees, error: employeeError } = await supabase
        .from('users')
        .select('id, first_name, last_name, wage')
        .in('id', employeeIds);

      if (employeeError) throw employeeError;

      const updates = [];
      const wageHistoryRecords = [];

      for (const employee of employees) {
        const currentWage = parseFloat(employee.wage || 0);
        let newWage;

        if (increaseType === 'percentage') {
          newWage = currentWage * (1 + increaseValue / 100);
        } else {
          newWage = currentWage + increaseValue;
        }

        // Round to 2 decimals
        newWage = Math.round(newWage * 100) / 100;

        if (newWage !== currentWage) {
          wageHistoryRecords.push({
            user_id: employee.id,
            business_id: businessId,
            previous_wage: currentWage,
            new_wage: newWage,
            effective_date: effectiveDate,
            reason: reason || `Bulk ${increaseType} increase`,
            change_type: 'bulk_increase',
            created_by: authUser.id
          });

          updates.push({
            id: employee.id,
            name: `${employee.first_name} ${employee.last_name}`,
            previousWage: currentWage,
            newWage: newWage
          });
        }
      }

      // Insert all wage history records
      if (wageHistoryRecords.length > 0) {
        const { error: insertError } = await supabase
          .from('hrpayroll_wage_history')
          .insert(wageHistoryRecords);

        if (insertError) throw insertError;
      }

      await recordAction('bulk_wage_increase', businessId, true);
      await logSecurityEvent('bulk_wage_increase_applied', {
        business_id: businessId,
        employees_affected: updates.length,
        increase_type: increaseType,
        increase_value: increaseValue,
        effective_date: effectiveDate
      }, 'high');

      return { success: true, updates };
    } catch (err) {
      setError(err.message);
      await recordAction('bulk_wage_increase', businessId, false);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [businessId, authUser, checkRateLimit, recordAction, logSecurityEvent]);

  /**
   * Get wage history for an employee
   */
  const getWageHistory = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase
        .from('hrpayroll_wage_history')
        .select(`
          *,
          created_by_user:users!created_by(first_name, last_name, email)
        `)
        .eq('user_id', userId)
        .eq('business_id', businessId)
        .order('effective_date', { ascending: false });

      if (error) throw error;
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [businessId]);

  /**
   * Get wage on specific date
   */
  const getWageOnDate = useCallback(async (userId, date) => {
    try {
      const { data, error } = await supabase
        .rpc('get_employee_wage_on_date', {
          p_user_id: userId,
          p_date: date
        });

      if (error) throw error;
      return parseFloat(data || 0);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  /**
   * Get all wage changes in a pay period
   */
  const getWageChangesInPeriod = useCallback(async (userId, startDate, endDate) => {
    try {
      const { data, error } = await supabase
        .rpc('get_wage_changes_in_period', {
          p_user_id: userId,
          p_start_date: startDate,
          p_end_date: endDate
        });

      if (error) throw error;
      return data || [];
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  return {
    loading,
    error,
    addWageChange,
    bulkWageIncrease,
    getWageHistory,
    getWageOnDate,
    getWageChangesInPeriod
  };
};