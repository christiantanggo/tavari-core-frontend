// components/HR/EmployeeEditModal.jsx - Updated with Lieu Time Integration
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';

// Import all required consistency files
import { SecurityWrapper } from '../../Security';
import { useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { useCanadianTaxCalculations } from '../../hooks/useCanadianTaxCalculations';
import POSAuthWrapper from '../Auth/POSAuthWrapper';
import TavariCheckbox from '../UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';

// Import the Lieu Time Modal
import EmployeeLieuTimeTrackingModal from './HREmployeeProfilesComponents/EmployeeLieuTimeTrackingModal';

const EmployeeEditModal = ({ 
  employee, 
  userContext, 
  isOpen, 
  onClose, 
  onSave,
  mode = 'edit'
}) => {
  const [formData, setFormData] = useState({});
  const [originalData, setOriginalData] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [managers, setManagers] = useState([]);
  const [changeReason, setChangeReason] = useState('');
  const [businessPayrollSettings, setBusinessPayrollSettings] = useState(null);
  const [roleOptions, setRoleOptions] = useState([]);
  const [selectedRole, setSelectedRole] = useState('employee');
  
  // Lieu Time Modal state
  const [showLieuTimeModal, setShowLieuTimeModal] = useState(false);

  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'EmployeeEditModal',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  const {
    selectedBusinessId,
    authUser,
    userRole,
    businessData
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager'],
    requireBusiness: true,
    componentName: 'EmployeeEditModal'
  });

  const { formatTaxAmount } = useTaxCalculations(userContext?.businessId || selectedBusinessId);
  const canadianTax = useCanadianTaxCalculations(userContext?.businessId || selectedBusinessId);

  const claimCodeOptions = [
    { value: 0, label: 'CC 0 - No exemptions (maximum tax deduction)' },
    { value: 1, label: 'CC 1 - Basic personal amount (most common)' },
    { value: 2, label: 'CC 2 - Basic + spouse amount' },
    { value: 3, label: 'CC 3 - Basic + eligible dependant (single parent)' },
    { value: 4, label: 'CC 4 - Basic + spouse + dependant' },
    { value: 5, label: 'CC 5 - Basic + spouse + multiple dependants' },
    { value: 6, label: 'CC 6 - Additional dependant credits' },
    { value: 7, label: 'CC 7 - Additional dependant credits' },
    { value: 8, label: 'CC 8 - Additional dependant credits' },
    { value: 9, label: 'CC 9 - Additional dependant credits' },
    { value: 10, label: 'CC 10 - Maximum claim amount (minimum tax deduction)' }
  ];

  const employmentStatuses = [
    { value: 'active', label: 'Active' },
    { value: 'probation', label: 'Probation' },
    { value: 'on_leave', label: 'On Leave' },
    { value: 'suspended', label: 'Suspended' },
    { value: 'terminated', label: 'Terminated' }
  ];

  const departments = [
    'Administration',
    'Human Resources',
    'Finance',
    'Marketing',
    'Sales',
    'Operations',
    'Customer Service',
    'IT/Technology',
    'Management',
    'Other'
  ];

  useEffect(() => {
    if (isOpen) {
      initializeForm();
      loadManagers();
      loadBusinessPayrollSettings();
      loadRolesAndCurrent();
    }
  }, [isOpen, employee]);

  const initializeForm = () => {
    const initialData = mode === 'create' ? {
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      employee_number: '',
      position: '',
      department: '',
      manager_id: '',
      hire_date: '',
      employment_status: 'active',
      wage: '',
      claim_code: 1,
      lieu_time_enabled: false,
      max_paid_hours_per_period: '',
      lieu_time_balance: 0
    } : {
      first_name: employee?.first_name || '',
      last_name: employee?.last_name || '',
      email: employee?.email || '',
      phone: employee?.phone || '',
      employee_number: employee?.employee_number || '',
      position: employee?.position || '',
      department: employee?.department || '',
      manager_id: employee?.manager_id || '',
      hire_date: employee?.hire_date || '',
      termination_date: employee?.termination_date || '',
      employment_status: employee?.employment_status || 'active',
      wage: employee?.wage || '',
      claim_code: employee?.claim_code || 1,
      lieu_time_enabled: employee?.lieu_time_enabled || false,
      max_paid_hours_per_period: employee?.max_paid_hours_per_period || '',
      lieu_time_balance: employee?.lieu_time_balance || 0
    };

    setFormData(initialData);
    setOriginalData(initialData);
    setErrors({});
    setChangeReason('');
  };

  const loadRolesAndCurrent = async () => {
    try {
      const businessId = userContext?.businessId || selectedBusinessId;
      if (!businessId) return;

      // Load available roles (distinct role_key for this business)
      const { data: rolesData, error: rolesError } = await supabase
        .from('role_permissions')
        .select('role_key')
        .eq('business_id', businessId);

      if (!rolesError && Array.isArray(rolesData)) {
        const unique = Array.from(new Set(rolesData.map(r => r.role_key).filter(Boolean))).sort();
        setRoleOptions(unique.length ? unique : ['owner','admin','manager','employee']);
      } else {
        setRoleOptions(['owner','admin','manager','employee']);
      }

      // Load employee's current role
      if (employee?.id) {
        const { data: currentRoleRow } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', employee.id)
          .eq('business_id', businessId)
          .eq('active', true)
          .maybeSingle();

        setSelectedRole(currentRoleRow?.role || 'employee');
      } else {
        setSelectedRole('employee');
      }
    } catch (err) {
      console.warn('Failed to load roles:', err?.message || err);
      if (!roleOptions.length) setRoleOptions(['owner','admin','manager','employee']);
    }
  };

  const loadManagers = async () => {
    try {
      setLoading(true);
      const { data: managerData, error: managerError } = await supabase
        .from('users')
        .select(`
          id,
          first_name,
          last_name,
          full_name,
          employee_number,
          business_users!inner(business_id, role)
        `)
        .eq('business_users.business_id', userContext?.businessId || selectedBusinessId)
        .in('business_users.role', ['owner', 'admin', 'manager'])
        .neq('id', employee?.id)
        .order('first_name');

      if (managerError) throw managerError;
      setManagers(managerData || []);
    } catch (error) {
      console.error('Error loading managers:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadBusinessPayrollSettings = async () => {
    try {
      const { data: payrollSettings, error: settingsError } = await supabase
        .from('hrpayroll_settings')
        .select('default_claim_code, tax_jurisdiction, use_cra_tax_tables')
        .eq('business_id', userContext?.businessId || selectedBusinessId)
        .single();

      if (settingsError && settingsError.code !== 'PGRST116') {
        console.error('Error loading payroll settings:', settingsError);
        return;
      }

      setBusinessPayrollSettings(payrollSettings);

      if (mode === 'create' && payrollSettings?.default_claim_code) {
        setFormData(prev => ({
          ...prev,
          claim_code: payrollSettings.default_claim_code
        }));
      }
    } catch (error) {
      console.error('Error loading business payroll settings:', error);
    }
  };

  const getUserFriendlyError = (error) => {
    if (!error) return 'An unknown error occurred';

    if (error.code === '22P02' || (error.message && error.message.includes('Invalid input value for enum'))) {
      if (error.message?.includes('audit_event_type')) {
        return 'Your changes were processed, but there was an issue with the system logging. The employee information has been updated successfully.';
      }
      return 'One of the selected values is not valid. Please check your entries and try again.';
    }

    if (error.code === '23505') {
      if (error.details?.includes('employee_number') || error.message?.includes('employee_number')) {
        const employeeNumber = error.details?.match(/Key \(employee_number\)=\(([^)]+)\)/)?.[1] || 
                              formData.employee_number || 'this value';
        return `Employee number "${employeeNumber}" is already in use. Please choose a different employee number or leave it blank for auto-generation.`;
      }
      if (error.details?.includes('email') || error.message?.includes('email')) {
        const email = error.details?.match(/Key \(email\)=\(([^)]+)\)/)?.[1] || 
                     formData.email || 'this email';
        return `Email address "${email}" is already registered. Please use a different email address.`;
      }
      return 'This information is already in use by another employee. Please check your entries and try again.';
    }

    if (error.code === '23503') {
      if (error.details?.includes('manager_id')) {
        return 'The selected manager is not valid. Please choose a different manager or leave this field empty.';
      }
      return 'One of the selected values is not valid. Please check your entries and try again.';
    }

    if (error.code === '23514') {
      return 'One of the entered values does not meet the required format. Please check your entries and try again.';
    }

    if (error.code === '42501') {
      return 'You do not have permission to perform this action. Please contact your administrator.';
    }

    if (error.message?.includes('Failed to fetch') || error.message?.includes('network')) {
      return 'Network connection error. Please check your internet connection and try again.';
    }

    if (error.message?.includes('timeout')) {
      return 'The request timed out. Please try again in a moment.';
    }

    if (error.message) {
      let cleanMessage = error.message
        .replace(/Invalid input value for enum [^:]+:/gi, 'Invalid selection made')
        .replace(/duplicate key value violates unique constraint "[^"]*"/gi, 'This value is already in use')
        .replace(/Key \([^)]+\)=\([^)]+\) already exists/gi, 'This value is already in use')
        .replace(/null value in column "[^"]*"/gi, 'A required field is missing')
        .replace(/invalid input syntax for type [^:]+:/gi, 'Invalid format entered')
        .replace(/relation "[^"]*" does not exist/gi, 'System configuration error')
        .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/g, '[ID]')
        .replace(/users_employee_number_key/gi, 'employee number constraint')
        .replace(/users_email_key/gi, 'email constraint')
        .replace(/audit_event_type/gi, 'system logging');
      
      if (cleanMessage.includes('constraint') || cleanMessage.includes('violates') || 
          cleanMessage.includes('23505') || cleanMessage.includes('PGRST') ||
          cleanMessage.includes('22P02')) {
        if (formData.employee_number) {
          return `Employee number "${formData.employee_number}" is already in use. Please choose a different number or leave it blank.`;
        }
        return 'The information you entered conflicts with existing data. Please check your entries and try again.';
      }
      
      return cleanMessage.charAt(0).toUpperCase() + cleanMessage.slice(1) + 
             (cleanMessage.endsWith('.') ? '' : '.');
    }

    return 'An unexpected error occurred. Please try again or contact support if the problem persists.';
  };

  const validateForm = async () => {
    const newErrors = {};
    
    if (!formData.first_name?.trim()) {
      newErrors.first_name = 'First name is required';
    }
    
    if (!formData.last_name?.trim()) {
      newErrors.last_name = 'Last name is required';
    }
    
    if (!formData.email?.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Valid email is required';
    }

    if (formData.wage && (isNaN(formData.wage) || parseFloat(formData.wage) < 0)) {
      newErrors.wage = 'Wage must be a positive number';
    }

    if (formData.claim_code < 0 || formData.claim_code > 10) {
      newErrors.claim_code = 'Claim code must be between 0 and 10';
    }

    // Lieu time validation
    if (formData.lieu_time_enabled && (!formData.max_paid_hours_per_period || parseFloat(formData.max_paid_hours_per_period) <= 0)) {
      newErrors.max_paid_hours_per_period = 'Maximum paid hours must be set when lieu time is enabled';
    }

    try {
      const emailValidation = await validateInput(formData.email, 'email', 'email');
      if (!emailValidation.valid) {
        newErrors.email = emailValidation.error;
      }

      const nameValidation = await validateInput(formData.first_name, 'text', 'first_name');
      if (!nameValidation.valid) {
        newErrors.first_name = nameValidation.error;
      }

      if (formData.wage) {
        const wageValidation = await validateInput(formData.wage.toString(), 'number', 'wage');
        if (!wageValidation.valid) {
          newErrors.wage = wageValidation.error;
        }
      }
    } catch (error) {
      console.error('Validation error:', error);
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const getChangedFields = () => {
    const changes = [];
    Object.keys(formData).forEach(field => {
      if (formData[field] !== originalData[field]) {
        changes.push(field);
      }
    });
    return changes;
  };

  const hasChanges = () => {
    return getChangedFields().length > 0;
  };

  const formatFieldName = (field) => {
    const fieldNames = {
      'first_name': 'First Name',
      'last_name': 'Last Name',
      'email': 'Email',
      'phone': 'Phone',
      'employee_number': 'Employee Number',
      'hire_date': 'Hire Date',
      'termination_date': 'Termination Date',
      'employment_status': 'Employment Status',
      'department': 'Department',
      'position': 'Position',
      'manager_id': 'Manager',
      'wage': 'Hourly Wage',
      'claim_code': 'CRA Claim Code',
      'lieu_time_enabled': 'Lieu Time Enabled',
      'max_paid_hours_per_period': 'Max Paid Hours Per Period'
    };
    return fieldNames[field] || field;
  };

  const handleInputChange = async (name, value) => {
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
    
    if (name === 'claim_code') {
      const claimCode = parseInt(value);
      if (isNaN(claimCode) || claimCode < 0 || claimCode > 10) {
        setErrors(prev => ({ ...prev, [name]: 'Claim code must be between 0 and 10' }));
        return;
      }
    }

    if (name === 'wage') {
      const wage = parseFloat(value);
      if (value && (isNaN(wage) || wage < 0)) {
        setErrors(prev => ({ ...prev, [name]: 'Wage must be a positive number' }));
        return;
      }
    }

    if (name === 'max_paid_hours_per_period') {
      const hours = parseFloat(value);
      if (value && (isNaN(hours) || hours <= 0)) {
        setErrors(prev => ({ ...prev, [name]: 'Maximum hours must be a positive number' }));
        return;
      }
    }

    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!(await validateForm())) {
      return;
    }

    const rateLimitCheck = await checkRateLimit('employee_update');
    if (!rateLimitCheck.allowed) {
      setErrors({ general: 'You are making changes too quickly. Please wait a moment before trying again.' });
      return;
    }

    try {
      setSaving(true);
      setErrors({});
      
      await recordAction('employee_edit_attempt', true);

      let result;
      
      if (mode === 'create') {
        result = await createEmployee();
      } else {
        result = await updateEmployee();
      }

      if (result.success) {
        await recordAction('employee_edit_success', true);
        onSave(result.employee);
        onClose();
      }

    } catch (error) {
      console.error('Error saving employee:', error);
      await recordAction('employee_edit_failure', false);
      
      const errorMessage = getUserFriendlyError(error);
      
      if (errorMessage.includes('employee number')) {
        setErrors({ 
          employee_number: errorMessage,
          general: null 
        });
      } else if (errorMessage.includes('email')) {
        setErrors({ 
          email: errorMessage,
          general: null 
        });
      } else {
        setErrors({ general: errorMessage });
      }
    } finally {
      setSaving(false);
    }
  };

  const createEmployee = async () => {
    const userData = {
      first_name: formData.first_name,
      last_name: formData.last_name,
      full_name: `${formData.first_name} ${formData.last_name}`,
      email: formData.email,
      phone: formData.phone,
      employee_number: formData.employee_number || null,
      position: formData.position || null,
      department: formData.department || null,
      manager_id: formData.manager_id || null,
      hire_date: formData.hire_date || null,
      employment_status: formData.employment_status,
      wage: formData.wage ? parseFloat(formData.wage) : null,
      claim_code: parseInt(formData.claim_code) || 1,
      lieu_time_enabled: formData.lieu_time_enabled || false,
      max_paid_hours_per_period: formData.lieu_time_enabled && formData.max_paid_hours_per_period ? 
        parseFloat(formData.max_paid_hours_per_period) : null,
      lieu_time_balance: 0,
      roles: ['employee']
    };

    try {
      const { data: newUser, error: userError } = await supabase
        .from('users')
        .insert(userData)
        .select()
        .single();

      if (userError) {
        throw userError;
      }

      const { error: businessUserError } = await supabase
        .from('business_users')
        .insert({
          user_id: newUser.id,
          business_id: userContext?.businessId || selectedBusinessId,
          role: 'employee'
        });

      if (businessUserError) {
        throw new Error(`Employee created but failed to link to business: ${getUserFriendlyError(businessUserError)}`);
      }

      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({
          user_id: newUser.id,
          business_id: userContext?.businessId || selectedBusinessId,
          role: 'employee',
          active: true,
          custom_permissions: {}
        });

      if (roleError) {
        throw new Error(`Employee created but failed to assign role: ${getUserFriendlyError(roleError)}`);
      }

      try {
        await logSecurityEvent('employee_created_with_lieu_time', {
          employee_id: newUser.id,
          employee_email: formData.email,
          claim_code: formData.claim_code,
          wage: formData.wage ? parseFloat(formData.wage) : null,
          lieu_time_enabled: formData.lieu_time_enabled,
          max_paid_hours_per_period: formData.lieu_time_enabled ? parseFloat(formData.max_paid_hours_per_period) : null,
          business_id: userContext?.businessId || selectedBusinessId,
          created_by: authUser?.id
        }, 'medium');
      } catch (loggingError) {
        console.warn('Security logging failed (non-critical):', loggingError);
      }

      return { success: true, employee: newUser };
      
    } catch (error) {
      throw error;
    }
  };

  const updateEmployee = async () => {
    const changedFields = {};
    const allowedFields = [
      'first_name', 'last_name', 'email', 'phone', 'employee_number',
      'position', 'department', 'manager_id', 'hire_date', 'termination_date',
      'employment_status', 'wage', 'claim_code', 'lieu_time_enabled', 'max_paid_hours_per_period'
    ];

    Object.keys(formData).forEach(key => {
      if (allowedFields.includes(key) && formData[key] !== originalData[key]) {
        changedFields[key] = formData[key];
      }
    });

    if (Object.keys(changedFields).length === 0) {
      return { success: true, employee };
    }

    if (changedFields.first_name || changedFields.last_name) {
      changedFields.full_name = `${formData.first_name} ${formData.last_name}`;
    }

    if (changedFields.wage !== undefined) {
      changedFields.wage = changedFields.wage ? parseFloat(changedFields.wage) : null;
    }

    if (changedFields.claim_code !== undefined) {
      changedFields.claim_code = parseInt(changedFields.claim_code) || 1;
    }

    if (changedFields.lieu_time_enabled !== undefined) {
      changedFields.lieu_time_enabled = changedFields.lieu_time_enabled || false;
    }

    if (changedFields.max_paid_hours_per_period !== undefined) {
      // FIXED: Check formData.lieu_time_enabled instead of changedFields.lieu_time_enabled
      // If lieu_time_enabled wasn't changed, it won't be in changedFields, causing the value to be set to null
      const lieuTimeEnabled = changedFields.lieu_time_enabled !== undefined 
        ? changedFields.lieu_time_enabled 
        : formData.lieu_time_enabled;
      
      changedFields.max_paid_hours_per_period = lieuTimeEnabled && changedFields.max_paid_hours_per_period ? 
        parseFloat(changedFields.max_paid_hours_per_period) : null;
    }

    if (changedFields.base_wage !== undefined) {
      delete changedFields.base_wage;
    }

    try {
      const { data: updatedEmployee, error: updateError } = await supabase
        .from('users')
        .update(changedFields)
        .eq('id', employee.id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      // Upsert role assignment for this business
      try {
        const businessId = userContext?.businessId || selectedBusinessId;
        if (businessId && selectedRole) {
          // Ensure user_roles row exists and is active with the selected role
          const { data: existing } = await supabase
            .from('user_roles')
            .select('user_id')
            .eq('user_id', employee.id)
            .eq('business_id', businessId)
            .maybeSingle();

          if (existing) {
            await supabase
              .from('user_roles')
              .update({ role: selectedRole, active: true })
              .eq('user_id', employee.id)
              .eq('business_id', businessId);
          } else {
            await supabase
              .from('user_roles')
              .insert({ user_id: employee.id, business_id: businessId, role: selectedRole, active: true, custom_permissions: {} });
          }

          // Keep business_users role in sync if present
          await supabase
            .from('business_users')
            .update({ role: selectedRole })
            .eq('user_id', employee.id)
            .eq('business_id', businessId);
        }
      } catch (roleErr) {
        console.warn('Role update warning:', roleErr?.message || roleErr);
      }

      try {
        await logSecurityEvent('employee_updated_with_lieu_time', {
          employee_id: employee.id,
          employee_email: formData.email,
          changed_fields: Object.keys(changedFields),
          claim_code: formData.claim_code,
          wage: formData.wage ? parseFloat(formData.wage) : null,
          lieu_time_enabled: formData.lieu_time_enabled,
          max_paid_hours_per_period: formData.lieu_time_enabled ? parseFloat(formData.max_paid_hours_per_period) : null,
          business_id: userContext?.businessId || selectedBusinessId,
          updated_by: authUser?.id,
          change_reason: changeReason,
          field_changes: changedFields
        }, 'medium');
      } catch (loggingError) {
        console.warn('Security logging failed (non-critical):', loggingError);
      }

      return { success: true, employee: updatedEmployee };

    } catch (dbError) {
      throw dbError;
    }
  };

  const getClaimCodeDescription = (code) => {
    const option = claimCodeOptions.find(opt => opt.value === parseInt(code));
    return option ? option.label : `Claim Code ${code}`;
  };

  // Handle lieu time modal
  const handleOpenLieuTimeModal = () => {
    if (employee) {
      recordAction('open_lieu_time_modal', employee.id);
      setShowLieuTimeModal(true);
    }
  };

  // Handle delete employee
  const handleDeleteEmployee = async () => {
    if (!employee) return;

    const confirmDelete = window.confirm(
      `Are you sure you want to delete ${employee.first_name} ${employee.last_name}? This action cannot be undone.`
    );

    if (!confirmDelete) return;

    try {
      setSaving(true);

      await recordAction('delete_employee', employee.id);

      const { error: deleteError } = await supabase
        .from('users')
        .delete()
        .eq('id', employee.id);

      if (deleteError) throw deleteError;

      await logSecurityEvent('employee_deleted', {
        employee_id: employee.id,
        employee_name: `${employee.first_name} ${employee.last_name}`,
        deleted_by: authUser?.id
      }, 'high');

      // Close modal and refresh parent
      onSave(employee);
      onClose();

    } catch (error) {
      console.error('Error deleting employee:', error);
      setErrors({ general: 'Failed to delete employee: ' + error.message });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
      padding: TavariStyles.spacing.lg
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.xl || '16px',
      width: '100%',
      maxWidth: '900px',
      maxHeight: '90vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxShadow: TavariStyles.shadows?.xl || '0 20px 25px rgba(0,0,0,0.1)'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.gray50
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      margin: 0
    },
    closeButton: {
      background: 'none',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize['2xl'],
      cursor: 'pointer',
      color: TavariStyles.colors.gray500,
      padding: TavariStyles.spacing.sm,
      borderRadius: TavariStyles.borderRadius?.sm || '4px'
    },
    content: {
      flex: 1,
      overflow: 'auto',
      padding: TavariStyles.spacing.xl
    },
    section: {
      marginBottom: TavariStyles.spacing.xl
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      margin: `0 0 ${TavariStyles.spacing.md} 0`,
      paddingBottom: TavariStyles.spacing.sm,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`
    },
    formGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    formGroup: {
      display: 'flex',
      flexDirection: 'column'
    },
    label: {
      display: 'block',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs
    },
    input: {
      width: '100%',
      padding: '12px 16px',
      border: `2px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      outline: 'none',
      boxSizing: 'border-box',
      transition: 'border-color 0.2s ease'
    },
    inputError: {
      borderColor: TavariStyles.colors.danger,
      backgroundColor: `${TavariStyles.colors.errorBg}50`
    },
    select: {
      width: '100%',
      padding: '12px 16px',
      border: `2px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      outline: 'none',
      boxSizing: 'border-box',
      backgroundColor: TavariStyles.colors.white,
      cursor: 'pointer'
    },
    textarea: {
      resize: 'vertical',
      minHeight: '80px',
      width: '100%',
      padding: '12px 16px',
      border: `2px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      outline: 'none',
      boxSizing: 'border-box'
    },
    claimCodeInfo: {
      backgroundColor: TavariStyles.colors.infoBg,
      border: `1px solid ${TavariStyles.colors.info}30`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.sm
    },
    claimCodeTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.info,
      marginBottom: TavariStyles.spacing.xs
    },
    claimCodeDescription: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray700,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    lieuTimeInfo: {
      backgroundColor: TavariStyles.colors.primary + '10',
      border: `1px solid ${TavariStyles.colors.primary}30`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.sm
    },
    lieuTimeTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.primary,
      marginBottom: TavariStyles.spacing.xs
    },
    changesAlert: {
      backgroundColor: TavariStyles.colors.warningBg,
      border: `1px solid ${TavariStyles.colors.warning}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing.md
    },
    helpText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs
    },
    footer: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.gray50
    },
    leftActions: {
      display: 'flex',
      gap: TavariStyles.spacing.md
    },
    rightActions: {
      display: 'flex',
      gap: TavariStyles.spacing.md
    },
    cancelButton: {
      padding: '12px 24px',
      backgroundColor: TavariStyles.colors.gray100,
      color: TavariStyles.colors.gray700,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },
    saveButton: {
      padding: '12px 24px',
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },
    lieuTimeButton: {
      padding: '12px 24px',
      backgroundColor: TavariStyles.colors.primary + '20',
      color: TavariStyles.colors.primary,
      border: `1px solid ${TavariStyles.colors.primary}50`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },
    deleteButton: {
      padding: '12px 24px',
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.danger,
      border: `1px solid ${TavariStyles.colors.danger}50`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },
    errorText: {
      color: TavariStyles.colors.errorText,
      fontSize: TavariStyles.typography.fontSize.xs,
      marginTop: TavariStyles.spacing.xs,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    errorBanner: {
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.errorText,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `1px solid ${TavariStyles.colors.danger}`,
      marginBottom: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium
    }
  };

  return (
    <POSAuthWrapper
      componentName="EmployeeEditModal"
      requiredRoles={['owner', 'manager']}
      requireBusiness={true}
    >
      <SecurityWrapper
        componentName="EmployeeEditModal"
        sensitiveComponent={true}
        enableAuditLogging={true}
        securityLevel="high"
      >
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={styles.header}>
              <h2 style={styles.title}>
                {mode === 'create' ? 'Add New Employee' : 'Edit Employee'}
              </h2>
              <button onClick={onClose} style={styles.closeButton}>
                ×
              </button>
            </div>

            <div style={styles.content}>
              {errors.general && (
                <div style={styles.errorBanner}>
                  {errors.general}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>Personal Information</h3>
                  <div style={styles.formGrid}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>First Name *</label>
                      <input
                        type="text"
                        value={formData.first_name || ''}
                        onChange={(e) => handleInputChange('first_name', e.target.value)}
                        style={{
                          ...styles.input,
                          ...(errors.first_name ? styles.inputError : {})
                        }}
                        disabled={saving}
                      />
                      {errors.first_name && (
                        <p style={styles.errorText}>{errors.first_name}</p>
                      )}
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Last Name *</label>
                      <input
                        type="text"
                        value={formData.last_name || ''}
                        onChange={(e) => handleInputChange('last_name', e.target.value)}
                        style={{
                          ...styles.input,
                          ...(errors.last_name ? styles.inputError : {})
                        }}
                        disabled={saving}
                      />
                      {errors.last_name && (
                        <p style={styles.errorText}>{errors.last_name}</p>
                      )}
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Email *</label>
                      <input
                        type="email"
                        value={formData.email || ''}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                        style={{
                          ...styles.input,
                          ...(errors.email ? styles.inputError : {})
                        }}
                        disabled={saving}
                      />
                      {errors.email && (
                        <p style={styles.errorText}>{errors.email}</p>
                      )}
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Phone</label>
                      <input
                        type="tel"
                        value={formData.phone || ''}
                        onChange={(e) => handleInputChange('phone', e.target.value)}
                        style={styles.input}
                        disabled={saving}
                      />
                    </div>
                  </div>
                </div>

                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>Employment Information</h3>
                  <div style={styles.formGrid}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Role</label>
                      <select
                        value={selectedRole || 'employee'}
                        onChange={(e) => setSelectedRole(e.target.value)}
                        style={styles.select}
                        disabled={saving}
                      >
                        {(roleOptions.length ? roleOptions : ['owner','admin','manager','employee']).map((rk) => (
                          <option key={rk} value={rk}>{rk}</option>
                        ))}
                      </select>
                      <p style={styles.helpText}>Controls access across the app for this business.</p>
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Employee Number</label>
                      <input
                        type="text"
                        value={formData.employee_number || ''}
                        onChange={(e) => handleInputChange('employee_number', e.target.value)}
                        style={{
                          ...styles.input,
                          ...(errors.employee_number ? styles.inputError : {})
                        }}
                        disabled={saving}
                        placeholder="Optional - leave blank for auto-generation"
                      />
                      {errors.employee_number && (
                        <p style={styles.errorText}>{errors.employee_number}</p>
                      )}
                      <p style={styles.helpText}>
                        Employee numbers must be unique. Leave blank to auto-generate.
                      </p>
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Position</label>
                      <input
                        type="text"
                        value={formData.position || ''}
                        onChange={(e) => handleInputChange('position', e.target.value)}
                        style={styles.input}
                        disabled={saving}
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Department</label>
                      <select
                        value={formData.department || ''}
                        onChange={(e) => handleInputChange('department', e.target.value)}
                        style={styles.select}
                        disabled={saving}
                      >
                        <option value="">Select department</option>
                        {departments.map(dept => (
                          <option key={dept} value={dept}>
                            {dept}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Manager</label>
                      <select
                        value={formData.manager_id || ''}
                        onChange={(e) => handleInputChange('manager_id', e.target.value)}
                        style={styles.select}
                        disabled={saving}
                      >
                        <option value="">No Manager</option>
                        {managers.map(mgr => (
                          <option key={mgr.id} value={mgr.id}>
                            {mgr.first_name} {mgr.last_name} {mgr.employee_number && `(#${mgr.employee_number})`}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Hire Date</label>
                      <input
                        type="date"
                        value={formData.hire_date || ''}
                        onChange={(e) => handleInputChange('hire_date', e.target.value)}
                        style={styles.input}
                        disabled={saving}
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Employment Status</label>
                      <select
                        value={formData.employment_status || 'active'}
                        onChange={(e) => handleInputChange('employment_status', e.target.value)}
                        style={styles.select}
                        disabled={saving}
                      >
                        {employmentStatuses.map(status => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {formData.employment_status === 'terminated' && (
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Termination Date</label>
                        <input
                          type="date"
                          value={formData.termination_date || ''}
                          onChange={(e) => handleInputChange('termination_date', e.target.value)}
                          style={styles.input}
                          disabled={saving}
                        />
                        <p style={styles.helpText}>
                          Date when employment was terminated
                        </p>
                      </div>
                    )}

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Hourly Wage ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={formData.wage || ''}
                        onChange={(e) => handleInputChange('wage', e.target.value)}
                        style={{
                          ...styles.input,
                          ...(errors.wage ? styles.inputError : {})
                        }}
                        disabled={saving}
                        placeholder="0.00"
                      />
                      {errors.wage && (
                        <p style={styles.errorText}>{errors.wage}</p>
                      )}
                      <p style={styles.helpText}>
                        Current value: {formData.wage ? `$${formatTaxAmount(parseFloat(formData.wage))}/hour` : 'Not set'}
                      </p>
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>CRA Claim Code (TD1 Form) *</label>
                      <select
                        value={formData.claim_code || 1}
                        onChange={(e) => handleInputChange('claim_code', e.target.value)}
                        style={styles.select}
                        disabled={saving}
                      >
                        {claimCodeOptions.map(option => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {errors.claim_code && (
                        <p style={styles.errorText}>{errors.claim_code}</p>
                      )}
                      
                      <div style={styles.claimCodeInfo}>
                        <div style={styles.claimCodeTitle}>Current Selection:</div>
                        <div style={styles.claimCodeDescription}>
                          {getClaimCodeDescription(formData.claim_code)}
                        </div>
                        {businessPayrollSettings?.default_claim_code && (
                          <div style={styles.claimCodeDescription}>
                            Business default: CC {businessPayrollSettings.default_claim_code}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Lieu Time Section */}
                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>Lieu Time Settings</h3>
                  <div style={styles.formGrid}>
                    <div style={styles.formGroup}>
                      <TavariCheckbox
                        checked={formData.lieu_time_enabled || false}
                        onChange={(checked) => handleInputChange('lieu_time_enabled', checked)}
                        label="Enable Lieu Time Tracking"
                        size="md"
                        disabled={saving}
                      />
                      <p style={styles.helpText}>
                        Allow this employee to earn lieu time for hours worked above their maximum paid hours.
                      </p>
                    </div>

                    {formData.lieu_time_enabled && (
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Maximum Paid Hours Per Period *</label>
                        <input
                          type="number"
                          step="0.25"
                          min="0.25"
                          max="80"
                          value={formData.max_paid_hours_per_period || ''}
                          onChange={(e) => handleInputChange('max_paid_hours_per_period', e.target.value)}
                          style={{
                            ...styles.input,
                            ...(errors.max_paid_hours_per_period ? styles.inputError : {})
                          }}
                          disabled={saving}
                          placeholder="e.g., 37.5, 40, 44"
                        />
                        {errors.max_paid_hours_per_period && (
                          <p style={styles.errorText}>{errors.max_paid_hours_per_period}</p>
                        )}
                        <p style={styles.helpText}>
                          Maximum hours employee gets paid per pay period. Hours above this become lieu time.
                        </p>
                      </div>
                    )}

                    {formData.lieu_time_enabled && mode === 'edit' && (
                      <div style={styles.lieuTimeInfo}>
                        <div style={styles.lieuTimeTitle}>Current Lieu Time Balance</div>
                        <div style={styles.claimCodeDescription}>
                          {formatTaxAmount(formData.lieu_time_balance || 0)} hours
                          {formData.lieu_time_balance >= 40 && (
                            <span style={{color: TavariStyles.colors.warning}}> ⚠️ HIGH BALANCE</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div style={styles.section}>
                  <h3 style={styles.sectionTitle}>Claim Code Information</h3>
                  <div style={styles.claimCodeInfo}>
                    <div style={styles.claimCodeTitle}>About CRA Claim Codes:</div>
                    <div style={styles.claimCodeDescription}>
                      The claim code determines how much income tax is deducted from the employee's paycheck. 
                      This should match what the employee selected on their TD1 Personal Tax Credits Return form.
                      <br /><br />
                      <strong>Common codes:</strong>
                      <br />• CC 0: Maximum tax deductions (no personal exemptions)
                      <br />• CC 1: Most common - basic personal amount only
                      <br />• CC 2-3: Include spouse or dependant amounts
                      <br />• CC 10: Maximum exemptions (minimum tax deductions)
                    </div>
                  </div>
                </div>

                {mode === 'edit' && hasChanges() && (
                  <div style={styles.section}>
                    <h3 style={styles.sectionTitle}>Change Summary</h3>
                    <div style={styles.changesAlert}>
                      <p><strong>Changes Detected:</strong></p>
                      <p>The following fields will be updated: {getChangedFields().map(formatFieldName).join(', ')}</p>
                    </div>

                    <div style={{marginTop: TavariStyles.spacing.md}}>
                      <label style={styles.label}>Reason for Changes (Optional)</label>
                      <textarea
                        value={changeReason}
                        onChange={(e) => setChangeReason(e.target.value)}
                        rows={3}
                        style={styles.textarea}
                        placeholder="Brief explanation of why these changes are being made..."
                        disabled={saving}
                      />
                      <p style={styles.helpText}>
                        This will be recorded in the employee's audit history for compliance purposes.
                      </p>
                    </div>
                  </div>
                )}
              </form>
            </div>

            {/* Updated Footer with Lieu Time and Delete buttons */}
            <div style={styles.footer}>
              <div style={styles.leftActions}>
                {/* Lieu Time button - only show for existing employees with lieu time enabled */}
                {mode === 'edit' && employee && formData.lieu_time_enabled && (
                  <button
                    type="button"
                    onClick={handleOpenLieuTimeModal}
                    style={styles.lieuTimeButton}
                    disabled={saving}
                  >
                    Lieu Time
                  </button>
                )}
              </div>
              
              <div style={styles.rightActions}>
                <button
                  type="button"
                  onClick={onClose}
                  style={styles.cancelButton}
                  disabled={saving}
                >
                  Cancel
                </button>
                
                <button
                  type="submit"
                  onClick={handleSubmit}
                  style={styles.saveButton}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : (mode === 'create' ? 'Create Employee' : 'Save Changes')}
                </button>

                {/* Delete button - only show for existing employees */}
                {mode === 'edit' && employee && (userRole === 'owner' || userRole === 'manager') && (
                  <button
                    type="button"
                    onClick={handleDeleteEmployee}
                    style={styles.deleteButton}
                    disabled={saving}
                  >
                    {saving ? 'Deleting...' : 'Delete Employee'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Lieu Time Modal */}
        {showLieuTimeModal && employee && (
          <EmployeeLieuTimeTrackingModal
            isOpen={showLieuTimeModal}
            onClose={() => setShowLieuTimeModal(false)}
            employee={employee}
            businessId={userContext?.businessId || selectedBusinessId}
            onBalanceUpdate={(newBalance) => {
              // Update the form data with new balance
              setFormData(prev => ({ ...prev, lieu_time_balance: newBalance }));
            }}
          />
        )}
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default EmployeeEditModal;