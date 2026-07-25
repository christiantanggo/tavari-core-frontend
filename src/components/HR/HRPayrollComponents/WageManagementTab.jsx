// components/HR/HRPayrollComponents/WageManagementTab.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useWageManagement } from '../../../hooks/useWageManagement';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import { TavariStyles } from '../../../utils/TavariStyles';
import PositionLabel from '../PositionLabel';

const WageManagementTab = ({ selectedBusinessId, businessData }) => {
  // State
  const [employees, setEmployees] = useState([]);
  const [filteredEmployees, setFilteredEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  
  // Bulk update state
  const [bulkIncreaseAmount, setBulkIncreaseAmount] = useState('');
  const [bulkMinimumWage, setBulkMinimumWage] = useState('');
  const [bulkEffectiveDate, setBulkEffectiveDate] = useState(new Date().toISOString().split('T')[0]);
  const [bulkFilter, setBulkFilter] = useState('all'); // 'all', 'management', 'employees'
  const [bulkReason, setBulkReason] = useState('');
  const [bulkIncreaseType, setBulkIncreaseType] = useState('amount'); // 'amount' or 'percentage'
  
  // Minimum wage settings
  const [regularMinWage, setRegularMinWage] = useState('');
  const [studentMinWage, setStudentMinWage] = useState('');
  const [minWageEffectiveDate, setMinWageEffectiveDate] = useState(new Date().toISOString().split('T')[0]);
  
  // Individual employee wage updates
  const [employeeWageUpdates, setEmployeeWageUpdates] = useState({});
  const [employeeUpdateType, setEmployeeUpdateType] = useState({}); // 'amount' or 'percentage'
  const [employeeEffectiveDates, setEmployeeEffectiveDates] = useState({});
  
  // Completed payroll periods (for warning)
  const [completedPayrollPeriods, setCompletedPayrollPeriods] = useState([]);

  // Hooks
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'WageManagementTab',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  const {
    selectedBusinessId: authBusinessId,
    authUser,
    userRole
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'hr_admin'],
    requireBusiness: true,
    componentName: 'WageManagementTab'
  });

  const effectiveBusinessId = selectedBusinessId || authBusinessId;
  const wageManagement = useWageManagement(effectiveBusinessId);

  // Load data on mount
  useEffect(() => {
    if (effectiveBusinessId) {
      loadEmployees();
      loadCompletedPayrollPeriods();
      loadMinimumWageSettings();
    }
  }, [effectiveBusinessId]);

  // Filter employees when bulk filter changes
  useEffect(() => {
    filterEmployeesByRole();
  }, [employees, bulkFilter]);

  // Load employees
  const loadEmployees = async () => {
    try {
      setLoading(true);

      const { data: userData, error } = await supabase
        .from('users')
        .select(`
          id,
          first_name,
          last_name,
          email,
          wage,
          position,
          department,
          employment_status,
          business_users!inner(business_id, role)
        `)
        .eq('business_users.business_id', effectiveBusinessId)
        .in('employment_status', ['active', 'probation'])
        .order('first_name');

      if (error) throw error;

      const employeeList = (userData || []).map(user => ({
        id: user.id,
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        wage: parseFloat(user.wage || 0),
        position: user.position,
        department: user.department,
        role: user.business_users[0]?.role || 'employee',
        employment_status: user.employment_status
      }));

      setEmployees(employeeList);

      // Initialize employee update states
      const updateTypes = {};
      const effectiveDates = {};
      employeeList.forEach(emp => {
        updateTypes[emp.id] = 'amount';
        effectiveDates[emp.id] = new Date().toISOString().split('T')[0];
      });
      setEmployeeUpdateType(updateTypes);
      setEmployeeEffectiveDates(effectiveDates);

    } catch (error) {
      console.error('Error loading employees:', error);
      setMessage({ type: 'error', text: 'Failed to load employees' });
    } finally {
      setLoading(false);
    }
  };

  // Load completed payroll periods
  const loadCompletedPayrollPeriods = async () => {
    try {
      const { data, error } = await supabase
        .from('hrpayroll_runs')
        .select('pay_period_start, pay_period_end')
        .eq('business_id', effectiveBusinessId)
        .eq('status', 'finalized')
        .order('pay_period_end', { ascending: false });

      if (error) throw error;
      setCompletedPayrollPeriods(data || []);
    } catch (error) {
      console.error('Error loading payroll periods:', error);
    }
  };

  // Load minimum wage settings from hr_settings table
  const loadMinimumWageSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('hr_settings')
        .select('minimum_wage_regular, minimum_wage_student')
        .eq('business_id', effectiveBusinessId)
        .single();

      if (!error && data) {
        setRegularMinWage(data.minimum_wage_regular ? data.minimum_wage_regular.toString() : '');
        setStudentMinWage(data.minimum_wage_student ? data.minimum_wage_student.toString() : '');
      }
    } catch (error) {
      console.error('Error loading minimum wage settings:', error);
    }
  };

  // Filter employees by role
  const filterEmployeesByRole = () => {
    let filtered = [...employees];

    switch (bulkFilter) {
      case 'management':
        filtered = employees.filter(emp => 
          ['owner', 'manager', 'admin', 'hr_admin'].includes(emp.role)
        );
        break;
      case 'employees':
        filtered = employees.filter(emp => emp.role === 'employee');
        break;
      case 'all':
      default:
        filtered = employees;
        break;
    }

    setFilteredEmployees(filtered);
  };

  // Check if date falls in completed payroll period
  const checkDateInCompletedPeriod = (date) => {
    const checkDate = new Date(date);
    return completedPayrollPeriods.some(period => {
      const start = new Date(period.pay_period_start);
      const end = new Date(period.pay_period_end);
      return checkDate >= start && checkDate <= end;
    });
  };

  // Handle bulk increase by amount or percentage
  const handleBulkIncrease = async () => {
    if (!bulkIncreaseAmount || parseFloat(bulkIncreaseAmount) <= 0) {
      setMessage({ type: 'error', text: 'Please enter a valid increase amount' });
      return;
    }

    if (!bulkReason.trim()) {
      setMessage({ type: 'error', text: 'Please provide a reason for the wage increase' });
      return;
    }

    // Check for completed payroll warning
    if (checkDateInCompletedPeriod(bulkEffectiveDate)) {
      const confirmed = window.confirm(
        '⚠️ WARNING: The effective date falls within a completed payroll period. ' +
        'This may require back-pay calculations. Continue anyway?'
      );
      if (!confirmed) return;
    }

    try {
      setSaving(true);
      setMessage(null);

      const employeeIds = filteredEmployees.map(emp => emp.id);
      const result = await wageManagement.bulkWageIncrease({
        increaseType: bulkIncreaseType, // Use the state variable instead of hardcoded 'amount'
        increaseValue: parseFloat(bulkIncreaseAmount),
        effectiveDate: bulkEffectiveDate,
        reason: bulkReason,
        employeeIds: employeeIds
      });

      setMessage({ 
        type: 'success', 
        text: `Successfully updated wages for ${result.updates.length} employees` 
      });

      // Reload employees to show new wages
      await loadEmployees();
      setBulkIncreaseAmount('');
      setBulkReason('');

    } catch (error) {
      console.error('Error in bulk increase:', error);
      setMessage({ type: 'error', text: error.message || 'Failed to update wages' });
    } finally {
      setSaving(false);
    }
  };

  // Handle set minimum wage
  const handleSetMinimumWage = async () => {
    if (!bulkMinimumWage || parseFloat(bulkMinimumWage) <= 0) {
      setMessage({ type: 'error', text: 'Please enter a valid minimum wage' });
      return;
    }

    if (!bulkReason.trim()) {
      setMessage({ type: 'error', text: 'Please provide a reason for the wage change' });
      return;
    }

    // Check for completed payroll warning
    if (checkDateInCompletedPeriod(bulkEffectiveDate)) {
      const confirmed = window.confirm(
        '⚠️ WARNING: The effective date falls within a completed payroll period. ' +
        'This may require back-pay calculations. Continue anyway?'
      );
      if (!confirmed) return;
    }

    try {
      setSaving(true);
      setMessage(null);

      const minWage = parseFloat(bulkMinimumWage);
      
      // Filter only employees below minimum wage
      const employeesToUpdate = filteredEmployees.filter(emp => emp.wage < minWage);

      if (employeesToUpdate.length === 0) {
        setMessage({ 
          type: 'info', 
          text: 'No employees are below the specified minimum wage' 
        });
        setSaving(false);
        return;
      }

      const employeeIds = employeesToUpdate.map(emp => emp.id);
      
      // Use bulk increase with the difference for each employee
      const wageHistoryRecords = [];
      for (const employee of employeesToUpdate) {
        wageHistoryRecords.push({
          user_id: employee.id,
          business_id: effectiveBusinessId,
          previous_wage: employee.wage,
          new_wage: minWage,
          effective_date: bulkEffectiveDate,
          reason: bulkReason,
          change_type: 'minimum_wage_adjustment',
          created_by: authUser.id
        });
      }

      const { error } = await supabase
        .from('hrpayroll_wage_history')
        .insert(wageHistoryRecords);

      if (error) throw error;

      setMessage({ 
        type: 'success', 
        text: `Updated ${employeesToUpdate.length} employees to meet minimum wage of $${minWage.toFixed(2)}` 
      });

      await loadEmployees();
      setBulkMinimumWage('');
      setBulkReason('');

    } catch (error) {
      console.error('Error setting minimum wage:', error);
      setMessage({ type: 'error', text: error.message || 'Failed to update wages' });
    } finally {
      setSaving(false);
    }
  };

  // Handle individual employee wage update
  const handleIndividualWageUpdate = async (employeeId) => {
    const newValue = employeeWageUpdates[employeeId];
    const updateType = employeeUpdateType[employeeId];
    const effectiveDate = employeeEffectiveDates[employeeId];

    if (!newValue || parseFloat(newValue) <= 0) {
      setMessage({ type: 'error', text: 'Please enter a valid wage value' });
      return;
    }

    // Check for completed payroll warning
    if (checkDateInCompletedPeriod(effectiveDate)) {
      const confirmed = window.confirm(
        '⚠️ WARNING: The effective date falls within a completed payroll period. ' +
        'This may require back-pay calculations. Continue anyway?'
      );
      if (!confirmed) return;
    }

    try {
      setSaving(true);
      setMessage(null);

      const employee = employees.find(e => e.id === employeeId);
      let newWage;

      if (updateType === 'percentage') {
        const percentChange = parseFloat(newValue);
        newWage = employee.wage * (1 + percentChange / 100);
      } else {
        newWage = parseFloat(newValue);
      }

      newWage = Math.round(newWage * 100) / 100;

      await wageManagement.addWageChange(employeeId, {
        newWage: newWage,
        effectiveDate: effectiveDate,
        reason: `Individual wage ${updateType === 'percentage' ? 'percentage' : 'amount'} update`,
        changeType: 'manual'
      });

      setMessage({ 
        type: 'success', 
        text: `Successfully updated wage for ${employee.name}` 
      });

      // Clear the update field for this employee
      setEmployeeWageUpdates(prev => {
        const updated = { ...prev };
        delete updated[employeeId];
        return updated;
      });

      await loadEmployees();

    } catch (error) {
      console.error('Error updating individual wage:', error);
      setMessage({ type: 'error', text: error.message || 'Failed to update wage' });
    } finally {
      setSaving(false);
    }
  };

  // Update minimum wage settings
  const handleUpdateMinimumWageSettings = async () => {
    if (!regularMinWage && !studentMinWage) {
      setMessage({ type: 'error', text: 'Please enter at least one minimum wage value' });
      return;
    }

    try {
      setSaving(true);
      setMessage(null);

      const { error } = await supabase
        .from('hr_settings')
        .upsert({
          business_id: effectiveBusinessId,
          minimum_wage_regular: regularMinWage ? parseFloat(regularMinWage) : null,
          minimum_wage_student: studentMinWage ? parseFloat(studentMinWage) : null,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'business_id'
        });

      if (error) throw error;

      setMessage({ 
        type: 'success', 
        text: 'Minimum wage settings updated successfully' 
      });

      await logSecurityEvent('minimum_wage_settings_updated', {
        business_id: effectiveBusinessId,
        minimum_wage_regular: regularMinWage,
        minimum_wage_student: studentMinWage,
        effective_date: minWageEffectiveDate
      }, 'medium');

    } catch (error) {
      console.error('Error updating minimum wage settings:', error);
      setMessage({ type: 'error', text: 'Failed to update minimum wage settings' });
    } finally {
      setSaving(false);
    }
  };

  // Styles
  const styles = {
    container: {
      padding: '20px',
      maxWidth: '1400px',
      margin: '0 auto'
    },
    section: {
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '24px',
      marginBottom: '24px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    },
    sectionTitle: {
      fontSize: '18px',
      fontWeight: '600',
      color: TavariStyles.colors.gray900,
      marginBottom: '16px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    inputGroup: {
      marginBottom: '16px'
    },
    label: {
      display: 'block',
      fontSize: '14px',
      fontWeight: '500',
      color: TavariStyles.colors.gray700,
      marginBottom: '6px'
    },
    input: {
      width: '90%',
      padding: '10px 12px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: '6px',
      fontSize: '14px',
      fontFamily: 'inherit'
    },
    button: {
      padding: '10px 20px',
      backgroundColor: TavariStyles.colors.primary || '#14B8A6',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s'
    },
    buttonSecondary: {
      padding: '10px 20px',
      backgroundColor: 'white',
      color: TavariStyles.colors.primary || '#14B8A6',
      border: `2px solid ${TavariStyles.colors.primary || '#14B8A6'}`,
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s'
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
      gap: '16px'
    },
    radioGroup: {
      display: 'flex',
      gap: '16px',
      marginBottom: '12px'
    },
    radioOption: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      cursor: 'pointer'
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      marginTop: '16px'
    },
    th: {
      textAlign: 'left',
      padding: '12px',
      backgroundColor: TavariStyles.colors.gray50,
      borderBottom: `2px solid ${TavariStyles.colors.gray300}`,
      fontSize: '13px',
      fontWeight: '600',
      color: TavariStyles.colors.gray700
    },
    td: {
      padding: '12px',
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      fontSize: '14px'
    },
    message: {
      padding: '12px 16px',
      borderRadius: '8px',
      marginBottom: '16px',
      fontSize: '14px',
      fontWeight: '500'
    },
    messageSuccess: {
      backgroundColor: '#d1fae5',
      color: '#065f46',
      border: '1px solid #6ee7b7'
    },
    messageError: {
      backgroundColor: '#fee2e2',
      color: '#991b1b',
      border: '1px solid #fca5a5'
    },
    messageInfo: {
      backgroundColor: '#dbeafe',
      color: '#1e40af',
      border: '1px solid #93c5fd'
    },
    warning: {
      backgroundColor: '#fef3c7',
      color: '#92400e',
      padding: '12px 16px',
      borderRadius: '8px',
      marginTop: '8px',
      fontSize: '13px',
      border: '1px solid #fbbf24'
    }
  };

  if (loading) {
    return (
      <div style={{ ...styles.container, textAlign: 'center', padding: '60px 20px' }}>
        <div style={{ fontSize: '16px', color: TavariStyles.colors.gray600 }}>
          Loading wage management...
        </div>
      </div>
    );
  }

  return (
    <POSAuthWrapper requiredRoles={['owner', 'manager', 'hr_admin']}>
      <div style={styles.container}>
        {/* Message Display */}
        {message && (
          <div style={{
            ...styles.message,
            ...(message.type === 'success' ? styles.messageSuccess : 
                message.type === 'error' ? styles.messageError : 
                styles.messageInfo)
          }}>
            {message.text}
          </div>
        )}

        {/* Bulk Updates Section */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>
            💰 Bulk Wage Increase
          </div>

          {/* Filter Selection */}
          <div style={styles.inputGroup}>
            <label style={styles.label}>Apply Updates To:</label>
            <div style={styles.radioGroup}>
              <label style={styles.radioOption}>
                <input
                  type="radio"
                  value="all"
                  checked={bulkFilter === 'all'}
                  onChange={(e) => setBulkFilter(e.target.value)}
                  disabled={saving}
                />
                <span>All Employees ({employees.length})</span>
              </label>
              <label style={styles.radioOption}>
                <input
                  type="radio"
                  value="management"
                  checked={bulkFilter === 'management'}
                  onChange={(e) => setBulkFilter(e.target.value)}
                  disabled={saving}
                />
                <span>Management Only</span>
              </label>
              <label style={styles.radioOption}>
                <input
                  type="radio"
                  value="employees"
                  checked={bulkFilter === 'employees'}
                  onChange={(e) => setBulkFilter(e.target.value)}
                  disabled={saving}
                />
                <span>Employees Only</span>
              </label>
            </div>
            <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
              Currently filtering: {filteredEmployees.length} employee(s)
            </div>
          </div>

          {/* Increase Type Selection */}
          <div style={styles.inputGroup}>
            <label style={styles.label}>Increase Type:</label>
            <div style={styles.radioGroup}>
              <label style={styles.radioOption}>
                <input
                  type="radio"
                  value="amount"
                  checked={bulkIncreaseType === 'amount'}
                  onChange={(e) => setBulkIncreaseType(e.target.value)}
                  disabled={saving}
                />
                <span>Dollar Amount ($)</span>
              </label>
              <label style={styles.radioOption}>
                <input
                  type="radio"
                  value="percentage"
                  checked={bulkIncreaseType === 'percentage'}
                  onChange={(e) => setBulkIncreaseType(e.target.value)}
                  disabled={saving}
                />
                <span>Percentage (%)</span>
              </label>
            </div>
          </div>

          <div style={styles.grid}>
            {/* Increase Value */}
            <div>
              <label style={styles.label}>
                {bulkIncreaseType === 'percentage' ? 'Increase All Wages By (%)' : 'Increase All Wages By ($)'}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder={bulkIncreaseType === 'percentage' ? 'e.g., 2.5' : 'e.g., 0.50'}
                value={bulkIncreaseAmount}
                onChange={(e) => setBulkIncreaseAmount(e.target.value)}
                disabled={saving}
                style={styles.input}
              />
            </div>

            {/* Effective Date */}
            <div>
              <label style={styles.label}>Effective Date</label>
              <input
                type="date"
                value={bulkEffectiveDate}
                onChange={(e) => setBulkEffectiveDate(e.target.value)}
                disabled={saving}
                style={styles.input}
              />
              {checkDateInCompletedPeriod(bulkEffectiveDate) && (
                <div style={styles.warning}>
                  ⚠️ This date falls in a completed payroll period
                </div>
              )}
            </div>
          </div>

          <div style={styles.inputGroup}>
            {/* Reason */}
            <label style={styles.label}>Reason for Change *</label>
            <input
              type="text"
              placeholder="e.g., Annual raise, Cost of living adjustment"
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              disabled={saving}
              style={styles.input}
            />
          </div>

          <button
            onClick={handleBulkIncrease}
            disabled={saving || !bulkIncreaseAmount || !bulkReason.trim()}
            style={{
              ...styles.button,
              opacity: (saving || !bulkIncreaseAmount || !bulkReason.trim()) ? 0.5 : 1
            }}
          >
            {saving ? 'Processing...' : 'Apply Wage Increase'}
          </button>
        </div>

        {/* Minimum Wage Settings */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>
            ⚙️ Minimum Wage Settings & Enforcement
          </div>

          <div style={styles.grid}>
            <div>
              <label style={styles.label}>Regular Minimum Wage ($/hour)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g., 17.20"
                value={regularMinWage}
                onChange={(e) => setRegularMinWage(e.target.value)}
                disabled={saving}
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Student Minimum Wage ($/hour)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g., 16.20"
                value={studentMinWage}
                onChange={(e) => setStudentMinWage(e.target.value)}
                disabled={saving}
                style={styles.input}
              />
            </div>
          </div>

          <div style={{ marginTop: '24px', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
            <label style={{...styles.label, marginBottom: '12px'}}>Apply Minimum Wage to Employees Below Threshold:</label>
            <div style={styles.grid}>
              <div>
                <label style={styles.label}>Minimum Wage Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g., 17.20"
                  value={bulkMinimumWage}
                  onChange={(e) => setBulkMinimumWage(e.target.value)}
                  disabled={saving}
                  style={styles.input}
                />
              </div>
              <div>
                <label style={styles.label}>Effective Date</label>
                <input
                  type="date"
                  value={bulkEffectiveDate}
                  onChange={(e) => setBulkEffectiveDate(e.target.value)}
                  disabled={saving}
                  style={styles.input}
                />
              </div>
            </div>
            <div style={{marginTop: '12px'}}>
              <label style={styles.label}>Reason for Enforcement *</label>
              <input
                type="text"
                placeholder="e.g., Ontario minimum wage increase"
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                disabled={saving}
                style={styles.input}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
            <button
              onClick={handleUpdateMinimumWageSettings}
              disabled={saving}
              style={{
                ...styles.button,
                opacity: saving ? 0.5 : 1
              }}
            >
              {saving ? 'Saving...' : 'Save Minimum Wage Settings'}
            </button>
            <button
              onClick={handleSetMinimumWage}
              disabled={saving || !bulkMinimumWage || !bulkReason.trim()}
              style={{
                ...styles.buttonSecondary,
                opacity: (saving || !bulkMinimumWage || !bulkReason.trim()) ? 0.5 : 1
              }}
            >
              {saving ? 'Processing...' : 'Apply to Employees Below Minimum'}
            </button>
          </div>
        </div>

        {/* Individual Employee Wages */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>
            👥 Individual Employee Wages
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Employee Name</th>
                  <th style={styles.th}>Role/Position</th>
                  <th style={styles.th}>Current Wage</th>
                  <th style={styles.th}>Update Type</th>
                  <th style={styles.th}>New Value</th>
                  <th style={styles.th}>Effective Date</th>
                  <th style={styles.th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ ...styles.td, textAlign: 'center', padding: '40px' }}>
                      <div style={{ color: TavariStyles.colors.gray500 }}>
                        No employees found
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map(employee => (
                    <tr key={employee.id}>
                      <td style={styles.td}>
                        <div style={{ fontWeight: '500' }}>{employee.name}</div>
                        <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500 }}>
                          {employee.email}
                        </div>
                      </td>
                      <td style={styles.td}>
                        <div>
                          <PositionLabel
                            businessId={selectedBusinessId}
                            value={employee.position}
                            emptyFallback="Not set"
                          />
                        </div>
                        <div style={{ 
                          fontSize: '11px', 
                          color: TavariStyles.colors.gray500,
                          textTransform: 'capitalize' 
                        }}>
                          {employee.role}
                        </div>
                      </td>
                      <td style={styles.td}>
                        <strong>${employee.wage.toFixed(2)}</strong>/hour
                      </td>
                      <td style={styles.td}>
                        <select
                          value={employeeUpdateType[employee.id] || 'amount'}
                          onChange={(e) => setEmployeeUpdateType(prev => ({
                            ...prev,
                            [employee.id]: e.target.value
                          }))}
                          disabled={saving}
                          style={{ ...styles.input, width: '120px' }}
                        >
                          <option value="amount">$ Amount</option>
                          <option value="percentage">% Change</option>
                        </select>
                      </td>
                      <td style={styles.td}>
                        <input
                          type="number"
                          step="0.01"
                          placeholder={
                            employeeUpdateType[employee.id] === 'percentage' 
                              ? 'e.g., 5.0' 
                              : 'e.g., 18.50'
                          }
                          value={employeeWageUpdates[employee.id] || ''}
                          onChange={(e) => setEmployeeWageUpdates(prev => ({
                            ...prev,
                            [employee.id]: e.target.value
                          }))}
                          disabled={saving}
                          style={{ ...styles.input, width: '120px' }}
                        />
                      </td>
                      <td style={styles.td}>
                        <input
                          type="date"
                          value={employeeEffectiveDates[employee.id] || ''}
                          onChange={(e) => setEmployeeEffectiveDates(prev => ({
                            ...prev,
                            [employee.id]: e.target.value
                          }))}
                          disabled={saving}
                          style={{ ...styles.input, width: '150px' }}
                        />
                        {checkDateInCompletedPeriod(employeeEffectiveDates[employee.id]) && (
                          <div style={{ fontSize: '11px', color: '#d97706', marginTop: '4px' }}>
                            ⚠️ Completed period
                          </div>
                        )}
                      </td>
                      <td style={styles.td}>
                        <button
                          onClick={() => handleIndividualWageUpdate(employee.id)}
                          disabled={saving || !employeeWageUpdates[employee.id]}
                          style={{
                            ...styles.button,
                            padding: '8px 16px',
                            fontSize: '13px',
                            opacity: (saving || !employeeWageUpdates[employee.id]) ? 0.5 : 1
                          }}
                        >
                          Update
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </POSAuthWrapper>
  );
};

export default WageManagementTab;