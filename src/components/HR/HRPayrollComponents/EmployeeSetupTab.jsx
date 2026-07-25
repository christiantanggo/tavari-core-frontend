// components/HR/HRPayrollComponents/EmployeeSetupTab.jsx - Fixed to use only 'wage' column
import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';

const EmployeeSetupTab = ({ selectedBusinessId, businessData, employees, loadData, updateEmployeePremium }) => {
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [newPremium, setNewPremium] = useState({
    premium_name: '',
    premium_rate: '',
    applies_to_all_hours: true
  });
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterOptions, setFilterOptions] = useState({
    showInactive: false,
    sortBy: 'name',
    filterByPremiums: 'all'
  });
  const [validationErrors, setValidationErrors] = useState({});

  // Security context for sensitive employee data
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'EmployeeSetupTab',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Tax calculations for formatting
  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId);

  // Filter and sort employees - FIXED: use 'wage' instead of 'wage'
  const filteredEmployees = employees ? employees.filter(employee => {
    const matchesSearch = !searchTerm || 
      `${employee.first_name} ${employee.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
      employee.email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const activePremiums = employee.hrpayroll_employee_premiums?.filter(p => p.is_active).length || 0;
    const matchesPremiumFilter = filterOptions.filterByPremiums === 'all' ||
      (filterOptions.filterByPremiums === 'with_premiums' && activePremiums > 0) ||
      (filterOptions.filterByPremiums === 'no_premiums' && activePremiums === 0);

    return matchesSearch && matchesPremiumFilter;
  }).sort((a, b) => {
    switch (filterOptions.sortBy) {
      case 'name':
        return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
      case 'wage':
        // FIXED: use 'wage' instead of 'wage'
        return (parseFloat(b.wage || 0) - parseFloat(a.wage || 0));
      case 'hire_date':
        return new Date(b.hire_date || 0) - new Date(a.hire_date || 0);
      default:
        return 0;
    }
  }) : [];

  // FIXED: validate 'wage' instead of 'wage'
  const validateEmployeeData = async (data) => {
    const errors = {};

    // Wage validation - FIXED: use 'wage' instead of 'wage'
    if (data.wage) {
      const wageValidation = await validateInput(data.wage, 'number', 'wage');
      if (!wageValidation.valid) {
        errors.wage = wageValidation.error;
      } else {
        const wage = parseFloat(data.wage);
        if (wage < 10 || wage > 200) {
          errors.wage = 'Wage must be between $10 and $200 per hour';
        }
      }
    }

    // Vacation percent validation
    if (data.vacation_percent) {
      const vacationValidation = await validateInput(data.vacation_percent, 'number', 'vacation_percent');
      if (!vacationValidation.valid) {
        errors.vacation_percent = vacationValidation.error;
      } else {
        const percent = parseFloat(data.vacation_percent);
        if (percent < 0 || percent > 0.20) {
          errors.vacation_percent = 'Vacation percentage must be between 0% and 20%';
        }
      }
    }

    // Max hours validation
    if (data.max_hours) {
      const hoursValidation = await validateInput(data.max_hours, 'number', 'max_hours');
      if (!hoursValidation.valid) {
        errors.max_hours = hoursValidation.error;
      } else {
        const hours = parseFloat(data.max_hours);
        if (hours < 1 || hours > 80) {
          errors.max_hours = 'Maximum hours must be between 1 and 80 per week';
        }
      }
    }

    // Date validation
    if (data.hire_date) {
      const hireDate = new Date(data.hire_date);
      const today = new Date();
      if (hireDate > today) {
        errors.hire_date = 'Hire date cannot be in the future';
      }
    }

    return errors;
  };

  const selectEmployee = (employee) => {
    setSelectedEmployee(employee);
    setEditingEmployee(null);
    setValidationErrors({});
  };

  const saveEmployeeData = async () => {
    if (!editingEmployee) return;

    try {
      setSaving(true);

      // Validate the employee data
      const errors = await validateEmployeeData(editingEmployee);
      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
        return;
      }

      // Rate limit check
      const rateLimitCheck = await checkRateLimit('update_employee_data');
      if (!rateLimitCheck.allowed) {
        setValidationErrors({ general: 'Rate limit exceeded. Please wait before making changes.' });
        return;
      }

      // Prepare update data - FIXED: only use valid database columns
      const updateData = {
        wage: editingEmployee.wage ? parseFloat(editingEmployee.wage) : null,
        vacation_percent: editingEmployee.vacation_percent ? parseFloat(editingEmployee.vacation_percent) : null,
        hire_date: editingEmployee.hire_date || null,
        last_raise_date: editingEmployee.last_raise_date || null,
        next_raise_date: editingEmployee.next_raise_date || null,
        max_hours: editingEmployee.max_hours ? parseInt(editingEmployee.max_hours) : null,
        lieu_tracking: editingEmployee.lieu_tracking || false
      };

      // Update the employee record
      const { data: updatedEmployee, error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', editingEmployee.id)
        .select()
        .single();

      if (updateError) throw updateError;

      // Log the update
      await recordAction('update_employee_payroll_data', true);
      await logSecurityEvent('employee_payroll_data_updated', {
        employee_id: editingEmployee.id,
        updated_fields: Object.keys(updateData),
        business_id: selectedBusinessId
      }, 'medium');

      // Update local state and refresh data
      setSelectedEmployee(updatedEmployee);
      setEditingEmployee(null);
      setValidationErrors({});
      
      if (loadData) {
        await loadData();
      }

    } catch (error) {
      console.error('Error updating employee data:', error);
      await recordAction('update_employee_payroll_data', false);
      setValidationErrors({ general: 'Failed to update employee information' });
    } finally {
      setSaving(false);
    }
  };

  const addNewPremium = async () => {
    if (!selectedEmployee || !newPremium.premium_name || !newPremium.premium_rate) {
      return;
    }

    try {
      setSaving(true);

      // Rate limit check
      const rateLimitCheck = await checkRateLimit('add_premium');
      if (!rateLimitCheck.allowed) {
        setValidationErrors({ premium: 'Rate limit exceeded. Please wait before adding premiums.' });
        return;
      }

      const premiumData = {
        business_id: selectedBusinessId,
        user_id: selectedEmployee.id,
        premium_name: newPremium.premium_name,
        premium_rate: parseFloat(newPremium.premium_rate),
        applies_to_all_hours: newPremium.applies_to_all_hours,
        is_active: true
      };

      const { error } = await supabase
        .from('hrpayroll_employee_premiums')
        .insert(premiumData);

      if (error) throw error;

      // Reset form and refresh data
      setNewPremium({
        premium_name: '',
        premium_rate: '',
        applies_to_all_hours: true
      });

      await recordAction('add_employee_premium', true);
      
      if (loadData) {
        await loadData();
      }

    } catch (error) {
      console.error('Error adding premium:', error);
      await recordAction('add_employee_premium', false);
      setValidationErrors({ premium: 'Failed to add premium' });
    } finally {
      setSaving(false);
    }
  };

  const togglePremium = async (premiumId, isActive) => {
    try {
      setSaving(true);

      const { error } = await supabase
        .from('hrpayroll_employee_premiums')
        .update({ is_active: !isActive })
        .eq('id', premiumId);

      if (error) throw error;

      await recordAction('toggle_employee_premium', true);
      
      if (loadData) {
        await loadData();
      }

    } catch (error) {
      console.error('Error toggling premium:', error);
      await recordAction('toggle_employee_premium', false);
    } finally {
      setSaving(false);
    }
  };

  // Handle no employees case
  if (!employees || employees.length === 0) {
    return (
      <POSAuthWrapper
        componentName="EmployeeSetupTab"
        requiredRoles={['owner', 'manager', 'hr_admin']}
        requireBusiness={true}
      >
        <SecurityWrapper
          componentName="EmployeeSetupTab"
          securityLevel="high"
          enableAuditLogging={true}
          sensitiveComponent={true}
        >
          <div style={styles.container}>
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>No Employees Found</h3>
              <div style={styles.infoBox}>
                Employees are managed through the main HR system.
                <br />
                <br />
                Please add employees in the Employee Management section before configuring payroll settings.
              </div>
            </div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper
      componentName="EmployeeSetupTab"
      requiredRoles={['owner', 'manager', 'hr_admin']}
      requireBusiness={true}
    >
      <SecurityWrapper
        componentName="EmployeeSetupTab"
        securityLevel="high"
        enableAuditLogging={true}
        sensitiveComponent={true}
      >
        <div style={styles.container}>
          {/* Employee Selection */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Employee Payroll Configuration</h3>
            <div style={styles.infoBox}>
              <strong>Employee Payroll Setup</strong><br />
              Configure payroll settings, wages, and premiums for each employee.
              Changes will apply to future payroll runs and are tracked for audit compliance.
            </div>

            {/* Search and Filter Controls */}
            <div style={styles.filterControls}>
              <div style={styles.searchGroup}>
                <input
                  type="text"
                  placeholder="Search employees..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={styles.searchInput}
                />
              </div>

              <div style={styles.filterGroup}>
                <select
                  value={filterOptions.sortBy}
                  onChange={(e) => setFilterOptions(prev => ({ ...prev, sortBy: e.target.value }))}
                  style={styles.select}
                >
                  <option value="name">Sort by Name</option>
                  <option value="wage">Sort by Wage</option>
                  <option value="hire_date">Sort by Hire Date</option>
                </select>

                <select
                  value={filterOptions.filterByPremiums}
                  onChange={(e) => setFilterOptions(prev => ({ ...prev, filterByPremiums: e.target.value }))}
                  style={styles.select}
                >
                  <option value="all">All Employees</option>
                  <option value="with_premiums">With Premiums</option>
                  <option value="no_premiums">No Premiums</option>
                </select>
              </div>
            </div>

            {/* Employee Grid */}
            <div style={styles.employeeGrid}>
              {filteredEmployees.map(employee => {
                const activePremiums = employee.hrpayroll_employee_premiums?.filter(p => p.is_active) || [];
                const totalPremiumRate = activePremiums.reduce((sum, premium) => sum + parseFloat(premium.premium_rate || 0), 0);

                return (
                  <div
                    key={employee.id}
                    style={{
                      ...styles.employeeCard,
                      ...(selectedEmployee?.id === employee.id ? styles.selectedCard : {})
                    }}
                    onClick={() => selectEmployee(employee)}
                  >
                    <div style={styles.employeeName}>
                      {employee.first_name} {employee.last_name}
                    </div>
                    <div style={styles.employeeDetails}>
                      {/* FIXED: use 'wage' instead of 'wage' */}
                      <strong>Hourly Wage:</strong> ${formatTaxAmount(parseFloat(employee.wage || 0))}/hr<br />
                      <strong>Email:</strong> {employee.email || 'Not set'}<br />
                      <strong>Hired:</strong> {employee.hire_date ? new Date(employee.hire_date).toLocaleDateString() : 'Not set'}<br />
                      <strong>Premiums:</strong> {activePremiums.length} active
                      {totalPremiumRate > 0 && (
                        <> (+${formatTaxAmount(totalPremiumRate)}/hr)</>
                      )}
                    </div>
                    <div style={styles.employeeStats}>
                      <span>ID: {employee.id.slice(-8)}</span>
                      <span>
                        {/* FIXED: use 'wage' instead of 'wage' */}
                        Max Rate: ${formatTaxAmount(parseFloat(employee.wage || 0) + totalPremiumRate)}/hr
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Employee Details */}
          {selectedEmployee && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>
                Employee Details: {selectedEmployee.first_name} {selectedEmployee.last_name}
              </h3>

              {/* Basic Payroll Info */}
              <div style={styles.detailsPanel}>
                <h4 style={{marginTop: 0, marginBottom: TavariStyles.spacing.md}}>Basic Payroll Information</h4>

                {editingEmployee ? (
                  <div>
                    <div style={styles.formGrid}>
                      <div style={styles.formGroup}>
                        {/* FIXED: use 'wage' instead of 'wage' */}
                        <label style={styles.label}>Hourly Wage ($)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="10"
                          max="200"
                          style={{
                            ...styles.input,
                            ...(validationErrors.wage ? styles.inputError : {})
                          }}
                          value={editingEmployee.wage || ''}
                          onChange={(e) => setEditingEmployee(prev => ({ ...prev, wage: e.target.value }))}
                        />
                        {validationErrors.wage && (
                          <div style={styles.errorText}>{validationErrors.wage}</div>
                        )}
                      </div>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Vacation Pay % (Optional)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="0.20"
                          style={{
                            ...styles.input,
                            ...(validationErrors.vacation_percent ? styles.inputError : {})
                          }}
                          value={editingEmployee.vacation_percent || ''}
                          onChange={(e) => setEditingEmployee(prev => ({ ...prev, vacation_percent: e.target.value }))}
                          placeholder="Leave blank for business default"
                        />
                        {validationErrors.vacation_percent && (
                          <div style={styles.errorText}>{validationErrors.vacation_percent}</div>
                        )}
                      </div>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Hire Date</label>
                        <input
                          type="date"
                          style={{
                            ...styles.input,
                            ...(validationErrors.hire_date ? styles.inputError : {})
                          }}
                          value={editingEmployee.hire_date || ''}
                          onChange={(e) => setEditingEmployee(prev => ({ ...prev, hire_date: e.target.value }))}
                        />
                        {validationErrors.hire_date && (
                          <div style={styles.errorText}>{validationErrors.hire_date}</div>
                        )}
                      </div>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Last Raise Date</label>
                        <input
                          type="date"
                          style={styles.input}
                          value={editingEmployee.last_raise_date || ''}
                          onChange={(e) => setEditingEmployee(prev => ({ ...prev, last_raise_date: e.target.value }))}
                        />
                      </div>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Next Raise Date</label>
                        <input
                          type="date"
                          style={styles.input}
                          value={editingEmployee.next_raise_date || ''}
                          onChange={(e) => setEditingEmployee(prev => ({ ...prev, next_raise_date: e.target.value }))}
                        />
                      </div>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Max Hours per Week</label>
                        <input
                          type="number"
                          min="1"
                          max="80"
                          style={{
                            ...styles.input,
                            ...(validationErrors.max_hours ? styles.inputError : {})
                          }}
                          value={editingEmployee.max_hours || ''}
                          onChange={(e) => setEditingEmployee(prev => ({ ...prev, max_hours: e.target.value }))}
                          placeholder="No limit"
                        />
                        {validationErrors.max_hours && (
                          <div style={styles.errorText}>{validationErrors.max_hours}</div>
                        )}
                      </div>
                    </div>

                    <div style={styles.checkboxGroup}>
                      <TavariCheckbox
                        checked={editingEmployee.lieu_tracking || false}
                        onChange={(checked) => setEditingEmployee(prev => ({ ...prev, lieu_tracking: checked }))}
                        label="Enable Lieu Time Tracking"
                      />
                    </div>

                    <div style={styles.buttonGroup}>
                      <button
                        style={styles.cancelButton}
                        onClick={() => setEditingEmployee(null)}
                        disabled={saving}
                      >
                        Cancel
                      </button>
                      <button
                        style={styles.saveButton}
                        onClick={saveEmployeeData}
                        disabled={saving}
                      >
                        {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>

                    {validationErrors.general && (
                      <div style={styles.errorText}>{validationErrors.general}</div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div style={styles.infoGrid}>
                      <div>
                        {/* FIXED: use 'wage' instead of 'wage' */}
                        <strong>Hourly Wage:</strong> ${formatTaxAmount(parseFloat(selectedEmployee.wage || 0))}/hr
                      </div>
                      <div>
                        <strong>Vacation %:</strong> {selectedEmployee.vacation_percent ? (() => {
                          const percent = parseFloat(selectedEmployee.vacation_percent);
                          // If stored as percentage (>= 1.0), display directly; if stored as decimal (< 1.0), multiply by 100
                          return percent >= 1.0 ? `${percent.toFixed(1)}%` : `${(percent * 100).toFixed(1)}%`;
                        })() : 'Business default'}
                      </div>
                      <div>
                        <strong>Hired:</strong> {selectedEmployee.hire_date ? new Date(selectedEmployee.hire_date).toLocaleDateString() : 'Not set'}
                      </div>
                      <div>
                        <strong>Last Raise:</strong> {selectedEmployee.last_raise_date ? new Date(selectedEmployee.last_raise_date).toLocaleDateString() : 'Not set'}
                      </div>
                      <div>
                        <strong>Next Raise:</strong> {selectedEmployee.next_raise_date ? new Date(selectedEmployee.next_raise_date).toLocaleDateString() : 'Not scheduled'}
                      </div>
                      <div>
                        <strong>Max Hours:</strong> {selectedEmployee.max_hours || 'No limit'} per week
                      </div>
                      <div>
                        <strong>Lieu Tracking:</strong> {selectedEmployee.lieu_tracking ? 'Enabled' : 'Disabled'}
                      </div>
                    </div>

                    <button
                      style={styles.button}
                      onClick={() => setEditingEmployee({...selectedEmployee})}
                    >
                      Edit Employee Info
                    </button>
                  </div>
                )}
              </div>

              {/* Premiums Section */}
              <div style={styles.detailsPanel}>
                <h4 style={{marginTop: 0, marginBottom: TavariStyles.spacing.md}}>Shift Premiums & Pay Differentials</h4>

                <div style={styles.warningBox}>
                  <strong>⚠️ Premium Configuration</strong><br />
                  Premiums are additional hourly rates for special qualifications, certifications, or responsibilities.
                  They will be automatically applied to payroll calculations when enabled.
                </div>

                {/* Existing Premiums */}
                {selectedEmployee.hrpayroll_employee_premiums && selectedEmployee.hrpayroll_employee_premiums.length > 0 ? (
                  <div style={styles.premiumsList}>
                    {selectedEmployee.hrpayroll_employee_premiums.map(premium => (
                      <div key={premium.id} style={styles.premiumCard}>
                        <div style={styles.premiumInfo}>
                          <div style={styles.premiumName}>{premium.premium_name}</div>
                          <div style={styles.premiumDetails}>
                            Rate: +${formatTaxAmount(premium.premium_rate)}/hr
                            {premium.applies_to_all_hours ? ' (All Hours)' : ' (Premium Hours Only)'}
                          </div>
                        </div>
                        <div style={styles.premiumActions}>
                          <TavariCheckbox
                            checked={premium.is_active}
                            onChange={() => togglePremium(premium.id, premium.is_active)}
                            label={premium.is_active ? 'Active' : 'Inactive'}
                            disabled={saving}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={styles.emptyState}>
                    No premiums configured for this employee.
                  </div>
                )}

                {/* Add New Premium */}
                <div style={styles.addPremiumSection}>
                  <h5 style={{marginTop: TavariStyles.spacing.lg, marginBottom: TavariStyles.spacing.md}}>Add New Premium</h5>
                  
                  <div style={styles.formGrid}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Premium Name</label>
                      <input
                        type="text"
                        value={newPremium.premium_name}
                        onChange={(e) => setNewPremium(prev => ({ ...prev, premium_name: e.target.value }))}
                        style={styles.input}
                        placeholder="e.g., Night Shift, Lead Position"
                        disabled={saving}
                      />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Premium Rate ($/hour)</label>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        value={newPremium.premium_rate}
                        onChange={(e) => setNewPremium(prev => ({ ...prev, premium_rate: e.target.value }))}
                        style={styles.input}
                        placeholder="2.50"
                        disabled={saving}
                      />
                    </div>
                  </div>

                  <div style={styles.checkboxGroup}>
                    <TavariCheckbox
                      checked={newPremium.applies_to_all_hours}
                      onChange={(checked) => setNewPremium(prev => ({ ...prev, applies_to_all_hours: checked }))}
                      label="Apply to all hours worked (vs. premium hours only)"
                      disabled={saving}
                    />
                  </div>

                  <button
                    style={styles.addButton}
                    onClick={addNewPremium}
                    disabled={saving || !newPremium.premium_name || !newPremium.premium_rate}
                  >
                    {saving ? 'Adding...' : 'Add Premium'}
                  </button>

                  {validationErrors.premium && (
                    <div style={styles.errorText}>{validationErrors.premium}</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

// Styles
const styles = {
  container: {
    padding: TavariStyles.spacing.lg,
    maxWidth: '1200px',
    margin: '0 auto'
  },
  section: {
    marginBottom: TavariStyles.spacing['2xl']
  },
  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.lg,
    borderBottom: `2px solid ${TavariStyles.colors.primary}`,
    paddingBottom: TavariStyles.spacing.sm
  },
  infoBox: {
    backgroundColor: TavariStyles.colors.infoBg,
    border: `1px solid ${TavariStyles.colors.info}30`,
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    padding: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.lg,
    fontSize: TavariStyles.typography.fontSize.sm,
    lineHeight: TavariStyles.typography.lineHeight.relaxed
  },
  warningBox: {
    backgroundColor: TavariStyles.colors.warningBg,
    border: `1px solid ${TavariStyles.colors.warning}`,
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    padding: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.lg,
    fontSize: TavariStyles.typography.fontSize.sm,
    lineHeight: TavariStyles.typography.lineHeight.relaxed
  },
  filterControls: {
    display: 'flex',
    gap: TavariStyles.spacing.lg,
    marginBottom: TavariStyles.spacing.lg,
    flexWrap: 'wrap'
  },
  searchGroup: {
    flex: 1,
    minWidth: '200px'
  },
  searchInput: {
    ...TavariStyles.components.form?.input || {
      width: '100%',
      padding: '10px 16px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm
    }
  },
  filterGroup: {
    display: 'flex',
    gap: TavariStyles.spacing.md
  },
  select: {
    ...TavariStyles.components.form?.select || {
      padding: '10px 16px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      backgroundColor: TavariStyles.colors.white
    }
  },
  employeeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: TavariStyles.spacing.md
  },
  employeeCard: {
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    backgroundColor: TavariStyles.colors.white,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
  },
  selectedCard: {
    borderColor: TavariStyles.colors.primary,
    backgroundColor: TavariStyles.colors.primary + '08',
    boxShadow: `0 0 0 3px ${TavariStyles.colors.primary}15, 0 2px 8px rgba(0,0,0,0.1)`
  },
  employeeName: {
    fontSize: TavariStyles.typography.fontSize.md,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.xs
  },
  employeeDetails: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    lineHeight: '1.5'
  },
  employeeStats: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: TavariStyles.spacing.sm,
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500
  },
  detailsPanel: {
    background: `linear-gradient(135deg, ${TavariStyles.colors.gray50} 0%, ${TavariStyles.colors.white} 100%)`,
    padding: TavariStyles.spacing.lg,
    borderRadius: TavariStyles.borderRadius?.lg || '12px',
    marginTop: TavariStyles.spacing.lg,
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: TavariStyles.spacing.md
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column'
  },
  label: {
    ...TavariStyles.components.form?.label || {
      display: 'block',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs
    }
  },
  input: {
    ...TavariStyles.components.form?.input || {
      padding: '10px 16px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm
    }
  },
  inputError: {
    borderColor: TavariStyles.colors.danger
  },
  checkboxGroup: {
    marginTop: TavariStyles.spacing.md
  },
  buttonGroup: {
    display: 'flex',
    gap: TavariStyles.spacing.md,
    marginTop: TavariStyles.spacing.lg
  },
  button: {
    ...TavariStyles.components.button?.base || {},
    ...TavariStyles.components.button?.variants?.primary || {},
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold
  },
  saveButton: {
    ...TavariStyles.components.button?.base || {},
    ...TavariStyles.components.button?.variants?.primary || {},
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold
  },
  cancelButton: {
    ...TavariStyles.components.button?.base || {},
    ...TavariStyles.components.button?.variants?.secondary || {},
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold
  },
  addButton: {
    ...TavariStyles.components.button?.base || {},
    ...TavariStyles.components.button?.variants?.success || {},
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    marginTop: TavariStyles.spacing.md
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.lg
  },
  premiumsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm,
    marginBottom: TavariStyles.spacing.lg
  },
  premiumCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: TavariStyles.borderRadius?.md || '6px',
    backgroundColor: TavariStyles.colors.white
  },
  premiumInfo: {
    flex: 1
  },
  premiumName: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray800
  },
  premiumDetails: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600,
    marginTop: TavariStyles.spacing.xs
  },
  premiumActions: {
    marginLeft: TavariStyles.spacing.md
  },
  addPremiumSection: {
    borderTop: `1px solid ${TavariStyles.colors.gray200}`,
    paddingTop: TavariStyles.spacing.lg
  },
  emptyState: {
    textAlign: 'center',
    color: TavariStyles.colors.gray500,
    fontStyle: 'italic',
    padding: TavariStyles.spacing.lg
  },
  errorText: {
    color: TavariStyles.colors.errorText,
    fontSize: TavariStyles.typography.fontSize.xs,
    marginTop: TavariStyles.spacing.xs
  }
};

export default EmployeeSetupTab;