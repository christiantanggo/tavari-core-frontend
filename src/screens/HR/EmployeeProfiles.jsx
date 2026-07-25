// screens/HR/EmployeeProfiles.jsx - WITH FULL PERMISSION SYSTEM (FIXED)
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Search, Filter, Plus, AlertCircle, X, CheckCircle, Mail, Printer } from 'lucide-react';
import { supabase } from '../../supabaseClient';

// Import all required consistency files
import { SecurityWrapper } from '../../Security';
import { useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import {
  mergeBusinessEmploymentOntoEmployees,
  updateBusinessEmploymentStatus,
} from '../../utils/businessEmploymentStatus';

// Import existing modals
import AddEmployeeModal from '../../components/HR/AddEmployeeModal';
import EmployeeEditModal from '../../components/HR/EmployeeEditModal';
import EmployeeAuditHistory from '../../components/HR/EmployeeAuditHistory';

// Import component-based modals
import EmployeeCard from '../../components/HR/HREmployeeProfilesComponents/EmployeeCard';
import EmployeePremiumAssignmentModal from '../../components/HR/HREmployeeProfilesComponents/EmployeePremiumAssignmentModal';
import EmployeeCertificateManagementModal from '../../components/HR/HREmployeeProfilesComponents/EmployeeCertificateManagementModal';
import EmployeeLieuTimeTrackingModal from '../../components/HR/HREmployeeProfilesComponents/EmployeeLieuTimeTrackingModal';
import EmployeeVacationPayModal from '../../components/HR/HREmployeeProfilesComponents/EmployeeVacationPayModal';
import EmployeeBirthdayManager from '../../components/HR/HREmployeeProfilesComponents/EmployeeBirthdayManager';
import EmployeeSINManager from '../../components/HR/HREmployeeProfilesComponents/EmployeeSINManager';
import EmployeeStudentPaySettings from '../../components/HR/HREmployeeProfilesComponents/EmployeeStudentPaySettings';
import EmployeeContractModal from '../../components/HR/HREmployeeProfilesComponents/EmployeeContractModal';
import toast from 'react-hot-toast';
import {
  enrichEmployeeWithContractContext,
  loadContractsByBusiness,
  pickContractForEmployee,
} from '../../utils/employeeContractContext';

function normalizeAuthEmail(email) {
  return (email || '').trim().toLowerCase();
}

/** public.users row for the signed-in operator (JWT id may differ from roster user_id). */
async function fetchOperatorPublicUserRow(supabaseClient, authUser) {
  const em = normalizeAuthEmail(authUser?.email);
  if (em) {
    const { data, error } = await supabaseClient
      .from('users')
      .select('id')
      .eq('email', em)
      .maybeSingle();
    if (!error && data) return data;
  }
  if (authUser?.id) {
    const { data, error } = await supabaseClient
      .from('users')
      .select('id')
      .eq('id', authUser.id)
      .maybeSingle();
    if (!error && data) return data;
  }
  return null;
}

const EmployeeProfiles = () => {
  const navigate = useNavigate();
  
  // Security context for sensitive employee data
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'EmployeeProfiles',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication using standardized hook
  const {
    selectedBusinessId,
    authUser,
    userRole,
    businessData,
    authLoading,
    authError,
    isManager,
    isOwner
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'EmployeeProfiles'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Tax calculations for formatting
  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId);

  // Component state
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [premiumFilter, setPremiumFilter] = useState('all');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [error, setError] = useState(null);

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAuditHistory, setShowAuditHistory] = useState(false);
  const [showPremiumAssignment, setShowPremiumAssignment] = useState(false);
  const [showCertificateManagement, setShowCertificateManagement] = useState(false);
  const [showLieuTimeModal, setShowLieuTimeModal] = useState(false);
  const [showVacationPayModal, setShowVacationPayModal] = useState(false);
  const [showResendSuccessModal, setShowResendSuccessModal] = useState(false);
  const [resendSuccessEmail, setResendSuccessEmail] = useState('');
  const [showBirthdayManager, setShowBirthdayManager] = useState(false);
  const [showSINManager, setShowSINManager] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportData, setReportData] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [showStudentPaySettings, setShowStudentPaySettings] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);

  // Available data for filtering
  const [departments, setDepartments] = useState([]);
  const [availablePremiums, setAvailablePremiums] = useState([]);
  const [availableCertificates, setAvailableCertificates] = useState([]);

  // User context for child components
  const userContext = {
    user: authUser,
    businessId: selectedBusinessId,
    role: userRole
  };

  // Permission checks
  // FIX: Add direct isOwner() check since owners should always have access
  const canViewEmployees = isOwner() || hasAnyPermission([
    'hr.employees.view',
    'hr.employees.view_all'
  ]) || hasElevatedPrivileges();

  const canCreateEmployees = isOwner() || hasPermission('hr.employees.create') || hasElevatedPrivileges();
  const canEditEmployees = isOwner() || hasPermission('hr.employees.edit') || hasElevatedPrivileges();
  const canDeleteEmployees = hasPermission('hr.employees.delete') || isOwner();
  const canTerminateEmployees = isOwner() || hasPermission('hr.employees.terminate') || hasElevatedPrivileges();
  const canViewAudit = isOwner() || hasPermission('hr.audit.view') || hasElevatedPrivileges();
  const canManageWages = isOwner() || hasPermission('hr.wages.manage') || hasElevatedPrivileges();
  const canManagePremiums = isOwner() || hasPermission('hr.premiums.manage') || hasElevatedPrivileges();
  const canManageCertificates = isOwner() || hasPermission('hr.certificates.manage') || hasElevatedPrivileges();
  const canManageLieuTime = isOwner() || hasPermission('hr.lieu_time.manage') || hasElevatedPrivileges();
  const canManageVacationPay = isOwner() || hasPermission('hr.vacation_pay.manage') || hasElevatedPrivileges();
  const canViewSensitiveData = hasPermission('hr.sensitive_data.view') || isOwner();

  // Check permissions on mount
  // FIX: Don't redirect if still loading or if user is owner (owners always have access)
  useEffect(() => {
    // Wait for permissions to load AND check owner role from auth (not just permissions)
    // Also check isOwner() function result
    const isUserOwner = isOwner() || userRole === 'owner';
    
    if (!permissionsLoading && !authLoading && !canViewEmployees && !isUserOwner) {
      toast.error('You do not have permission to view employee profiles');
      navigate('/dashboard/hr/dashboard');
    }
  }, [permissionsLoading, authLoading, canViewEmployees, isOwner, userRole]);

  // Load employees with premium and certificate data
  useEffect(() => {
    if (selectedBusinessId && !authLoading && !permissionsLoading && canViewEmployees) {
      loadEmployees();
      loadAvailablePremiums();
      loadAvailableCertificates();
    }
  }, [selectedBusinessId, authLoading, permissionsLoading, canViewEmployees]);

  const loadEmployees = async () => {
    try {
      setLoading(true);
      
      await logSecurityEvent('employee_data_access', {
        action: 'load_employee_profiles',
        business_id: selectedBusinessId
      }, 'low');
      
      // Use the original working approach - direct join with user_roles
      const { data: userData, error: userError } = await supabase
        .from('user_roles')
        .select(`
          user_id,
          role,
          business_id,
          users!inner (
            id, 
            first_name,
            last_name,
            full_name, 
            email,
            phone,
            position,
            department,
            employment_status,
            hire_date,
            termination_date,
            wage,
            employee_number,
            lieu_time_enabled,
            max_paid_hours_per_period,
            lieu_time_balance,
            vacation_percent,
            birth_date,
            student_pay_enabled,
            labor_subsidy_enabled,
            labor_subsidy_partner,
            labor_subsidy_wage_cap,
            labor_subsidy_max_hours_per_week,
            labor_subsidy_start_date,
            labor_subsidy_end_date,
            created_at
          )
        `)
        .eq('business_id', selectedBusinessId)
        .eq('active', true)
        .limit(200);

      if (userError) {
        console.error('Error loading employees:', userError);
        throw userError;
      }

      if (!userData || userData.length === 0) {
        console.log('No employees found for this business');
        setEmployees([]);
        setLoading(false);
        return;
      }

      // Transform the data to match expected format
      const transformedData = userData.map(entry => ({
        ...entry.users,
        role: entry.role
      }));

      const withBusinessEmployment = await mergeBusinessEmploymentOntoEmployees(
        supabase,
        selectedBusinessId,
        transformedData,
      );

      console.log(`✅ Loaded ${withBusinessEmployment.length} employees for business ${selectedBusinessId}`);

      // Load premium data if user has permission
      let premiumData = [];
      if (canManagePremiums) {
        const { data, error } = await supabase
          .from('hrpayroll_employee_premiums')
          .select('id, user_id, premium_name, premium_rate, applies_to_all_hours, is_active')
          .eq('business_id', selectedBusinessId)
          .eq('is_active', true)
          .in('user_id', withBusinessEmployment.map(emp => emp.id))
          .limit(500);

        if (!error) premiumData = data || [];
      }

      // Load certificate data if user has permission
      let certificateData = [];
      if (canManageCertificates) {
        const { data, error } = await supabase
          .from('employee_certificates')
          .select(`
            id, employee_id, certificate_id, issue_date, expiry_date, status,
            hr_certificates!inner(
              id,
              name,
              description,
              issuing_authority,
              requires_renewal,
              renewal_period_months
            )
          `)
          .eq('business_id', selectedBusinessId)
          .eq('status', 'active')
          .in('employee_id', withBusinessEmployment.map(emp => emp.id))
          .limit(500);

        if (!error) certificateData = data || [];
      }

      const data = withBusinessEmployment;
      const contractsByKey = await loadContractsByBusiness(selectedBusinessId);

      const transformedEmployees = (data || []).map(user => {
        const userPremiums = canManagePremiums ? (premiumData || [])
          .filter(premium => premium.user_id === user.id)
          .map(premium => ({
            id: premium.id,
            premium: {
              id: premium.id,
              name: premium.premium_name,
              rate: premium.premium_rate,
              rate_type: 'fixed_amount',
              applies_to_all_hours: premium.applies_to_all_hours
            },
            created_at: premium.created_at
          })) : [];

        const userCertificates = canManageCertificates ? (certificateData || [])
          .filter(cert => cert.employee_id === user.id && cert.hr_certificates)
          .map(cert => ({
            id: cert.id,
            certificate: cert.hr_certificates,
            issue_date: cert.issue_date,
            expiry_date: cert.expiry_date,
            certificate_number: cert.certificate_number,
            document_path: cert.document_path,
            status: cert.status,
            is_expired: cert.expiry_date ? new Date(cert.expiry_date) < new Date() : false,
            days_until_expiry: cert.expiry_date ? Math.ceil((new Date(cert.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)) : null
          })) : [];

        const baseEmployee = {
          id: user.id,
          role: user.role || 'employee',
          first_name: user.first_name || user.full_name?.split(' ')[0] || 'Unknown',
          last_name: user.last_name || user.full_name?.split(' ').slice(1).join(' ') || '',
          full_name: user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
          email: user.email,
          phone: user.phone,
          position: user.position,
          department: user.department,
          employment_status: user.employment_status || 'active',
          hire_date: user.hire_date,
          termination_date: user.termination_date,
          wage: canManageWages ? user.wage : null,
          employee_number: user.employee_number,
          lieu_time_enabled: user.lieu_time_enabled || false,
          max_paid_hours_per_period: user.max_paid_hours_per_period,
          lieu_time_balance: canManageLieuTime ? (user.lieu_time_balance || 0) : null,
          vacation_percent: canManageVacationPay ? user.vacation_percent : null,
          birth_date: canViewSensitiveData ? user.birth_date : null,
          student_pay_enabled: user.student_pay_enabled || false,
          created_at: user.created_at,
          active_premiums: userPremiums,
          active_certificates: userCertificates,
        };

        const contract = pickContractForEmployee(contractsByKey, baseEmployee);
        return enrichEmployeeWithContractContext(baseEmployee, contract);
      });
      
      setEmployees(transformedEmployees);

      const uniqueDepartments = [...new Set(
        transformedEmployees
          .map(emp => emp.department)
          .filter(dept => dept && dept.trim())
      )].sort();
      setDepartments(uniqueDepartments);

      console.log('Loaded employees with all data:', transformedEmployees);
      recordAction('view_employees', selectedBusinessId);
    } catch (error) {
      console.error('Error loading employees:', error);
      await logSecurityEvent('employee_data_access_failed', {
        error_message: error.message,
        business_id: selectedBusinessId
      }, 'medium');
      setError('Failed to load employees: ' + error.message);
      setEmployees([]);
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  };

  const loadAvailablePremiums = async () => {
    if (!canManagePremiums) return;

    try {
      const { data, error } = await supabase
        .from('hr_shift_premiums')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setAvailablePremiums(data || []);
    } catch (error) {
      console.error('Error loading available premiums:', error);
    }
  };

  const loadAvailableCertificates = async () => {
    if (!canManageCertificates) return;

    try {
      const { data, error } = await supabase
        .from('hr_certificates')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setAvailableCertificates(data || []);
    } catch (error) {
      console.error('Error loading available certificates:', error);
    }
  };

  // Event handlers for employee actions
  const handleEmployeeCreated = (newEmployee) => {
    setShowAddModal(false);
    loadEmployees();
    console.log('New employee created:', newEmployee);
    recordAction('create_employee', newEmployee.id);
    toast.success('Employee created successfully');
  };

  const handleEditEmployee = (employee) => {
    if (!canEditEmployees) {
      toast.error('You do not have permission to edit employees');
      return;
    }

    setSelectedEmployee(employee);
    setShowEditModal(true);
    console.log('Edit employee:', employee.id);
  };

  const handleEmployeeSaved = (updatedEmployee) => {
    setShowEditModal(false);
    setSelectedEmployee(null);
    loadEmployees();
    console.log('Employee updated:', updatedEmployee);
    recordAction('update_employee', updatedEmployee.id);
    toast.success('Employee updated successfully');
  };

  const handleViewAuditHistory = (employee) => {
    if (!canViewAudit) {
      toast.error('You do not have permission to view audit history');
      return;
    }

    setSelectedEmployee(employee);
    setShowAuditHistory(true);
    console.log('View audit history for employee:', employee.id);
    recordAction('view_audit_history', employee.id);
  };


  const handleManagePremiums = (employee) => {
    if (!canManagePremiums) {
      toast.error('You do not have permission to manage premiums');
      return;
    }

    setSelectedEmployee(employee);
    setShowPremiumAssignment(true);
    console.log('Manage premiums for employee:', employee.id);
    recordAction('manage_employee_premiums', employee.id);
  };

  const handleManageCertificates = (employee) => {
    if (!canManageCertificates) {
      toast.error('You do not have permission to manage certificates');
      return;
    }

    setSelectedEmployee(employee);
    setShowCertificateManagement(true);
    console.log('Manage certificates for employee:', employee.id);
    recordAction('manage_employee_certificates', employee.id);
  };

  const handleManageLieuTime = (employee) => {
    if (!canManageLieuTime) {
      toast.error('You do not have permission to manage lieu time');
      return;
    }

    setSelectedEmployee(employee);
    setShowLieuTimeModal(true);
    console.log('Manage lieu time for employee:', employee.id);
    recordAction('manage_employee_lieu_time', employee.id);
  };
  
  const handleManageVacationPay = (employee) => {
    if (!canManageVacationPay) {
      toast.error('You do not have permission to manage vacation pay');
      return;
    }

    setSelectedEmployee(employee);
    setShowVacationPayModal(true);
    console.log('Manage vacation pay for employee:', employee.id);
    recordAction('manage_employee_vacation_pay', employee.id);
  };

  const handleManageBirthday = (employee) => {
    if (!canViewSensitiveData) {
      toast.error('You do not have permission to manage employee birthdays');
      return;
    }

    setSelectedEmployee(employee);
    setShowBirthdayManager(true);
    console.log('Manage birthday for employee:', employee.id);
    recordAction('manage_employee_birthday', employee.id);
  };

  const handleManageSIN = (employee) => {
    if (!canViewSensitiveData) {
      toast.error('You do not have permission to manage SIN numbers');
      return;
    }

    setSelectedEmployee(employee);
    setShowSINManager(true);
    console.log('Manage SIN for employee:', employee.id);
    recordAction('manage_employee_sin', employee.id);
  };

  const handleToggleStudentPay = (employee) => {
    if (!canManageWages) {
      toast.error('You do not have permission to manage student pay settings');
      return;
    }

    setSelectedEmployee(employee);
    setShowStudentPaySettings(true);
    console.log('Toggle student pay for employee:', employee.id);
    recordAction('toggle_student_pay', employee.id);
  };

  const handleVacationPayUpdated = (employeeId, newVacationPercent) => {
    const updatedEmployees = employees.map(emp => 
      emp.id === employeeId ? { ...emp, vacation_percent: newVacationPercent } : emp
    );
    setEmployees(updatedEmployees);
  
    if (selectedEmployee?.id === employeeId) {
      setSelectedEmployee(prev => ({ ...prev, vacation_percent: newVacationPercent }));
    }
  
    console.log(`Updated vacation pay for employee ${employeeId}: ${(newVacationPercent * 100).toFixed(1)}%`);
  };

  const handleBirthdayUpdated = (employeeId, newBirthDate) => {
    const updatedEmployees = employees.map(emp => 
      emp.id === employeeId ? { ...emp, birth_date: newBirthDate } : emp
    );
    setEmployees(updatedEmployees);
  
    if (selectedEmployee?.id === employeeId) {
      setSelectedEmployee(prev => ({ ...prev, birth_date: newBirthDate }));
    }
  
    console.log(`Updated birthday for employee ${employeeId}: ${newBirthDate}`);
  };

  const handleSINUpdated = (employeeId, hasSIN) => {
    const updatedEmployees = employees.map(emp => 
      emp.id === employeeId ? { ...emp, sin_number: hasSIN ? '[PROTECTED]' : null } : emp
    );
    setEmployees(updatedEmployees);
  
    if (selectedEmployee?.id === employeeId) {
      setSelectedEmployee(prev => ({ ...prev, sin_number: hasSIN ? '[PROTECTED]' : null }));
    }
  
    console.log(`Updated SIN for employee ${employeeId}: ${hasSIN ? 'Set' : 'Removed'}`);
  };

  const handleStudentPayUpdated = (employeeId, studentPayEnabled) => {
    const updatedEmployees = employees.map(emp => 
      emp.id === employeeId ? { ...emp, student_pay_enabled: studentPayEnabled } : emp
    );
    setEmployees(updatedEmployees);
  
    if (selectedEmployee?.id === employeeId) {
      setSelectedEmployee(prev => ({ ...prev, student_pay_enabled: studentPayEnabled }));
    }
  
    console.log(`Updated student pay for employee ${employeeId}: ${studentPayEnabled}`);
  };

  const handleDeleteEmployee = async (employee) => {
    if (!canDeleteEmployees) {
      toast.error('You do not have permission to delete employees');
      return;
    }

    // Warn user this is for mistakes only, not terminations
    const confirmMessage = `⚠️ WARNING: This will PERMANENTLY DELETE ${employee.full_name} from the system.\n\n` +
      `This should only be used if the employee was created by mistake.\n\n` +
      `If the employee was actually hired and should be terminated, use "Terminate Employee" instead.\n\n` +
      `This action CANNOT be undone. Are you absolutely sure?`;
    
    if (!confirm(confirmMessage)) {
      return;
    }

    // Double confirmation for safety
    if (!confirm(`FINAL CONFIRMATION: Permanently delete ${employee.full_name}? This will remove all records.`)) {
      return;
    }

    try {
      await logSecurityEvent('employee_deletion_attempt', {
        employee_id: employee.id,
        employee_name: employee.full_name
      }, 'high');

      if (!selectedBusinessId) {
        toast.error('No business selected');
        return;
      }

      const operatorRow = await fetchOperatorPublicUserRow(supabase, authUser);
      if (String(employee.id) === String(operatorRow?.id ?? authUser?.id)) {
        toast.error('You cannot remove your own account from the roster here.');
        return;
      }

      const { data: rpcResult, error: rpcError } = await supabase.rpc('remove_employee_from_business', {
        p_target_user_id: employee.id,
        p_business_id: selectedBusinessId
      });

      if (rpcError) throw rpcError;

      const rowsRemoved =
        (rpcResult?.user_roles_deleted != null ? Number(rpcResult.user_roles_deleted) : 0) +
        (rpcResult?.business_users_deleted != null ? Number(rpcResult.business_users_deleted) : 0);

      await logSecurityEvent('employee_deleted', {
        employee_id: employee.id,
        employee_name: employee.full_name,
        deleted_by: authUser?.id,
        business_id: selectedBusinessId,
        rows_deleted: rowsRemoved,
        rpc_result: rpcResult
      }, 'high');
      
      console.log('Delete employee completed:', employee.id);
      recordAction('delete_employee', employee.id);
      
      // Reload employees to reflect the deletion
      await loadEmployees();
      
      toast.success(`${employee.full_name} has been permanently deleted from this business.`);
    } catch (error) {
      console.error('Error deleting employee:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      await logSecurityEvent('employee_deletion_failed', {
        employee_id: employee.id,
        error_message: error.message,
        error_code: error.code
      }, 'high');
      toast.error('Failed to delete employee: ' + (error.message || 'Unknown error'));
    }
  };

  const handleOpenReportModal = async () => {
    if (!selectedBusinessId) return;
    setReportModalOpen(true);
    setReportLoading(true);
    setReportError(null);
    setReportData([]);
    try {
      const { data, error } = await supabase.rpc('get_active_employees_report', {
        p_business_id: selectedBusinessId
      });
      if (error) throw error;
      setReportData(Array.isArray(data) ? data : data ? [data] : []);
    } catch (err) {
      console.error('Report fetch error:', err);
      setReportError(err.message || 'Failed to load report');
      setReportData([]);
    } finally {
      setReportLoading(false);
    }
  };

  const handlePrintReport = () => {
    const businessName = businessData?.business_name || businessData?.name || 'Company';
    const formatMoney = (n) => {
      if (n == null || n === '') return '—';
      const num = parseFloat(n);
      return isNaN(num) ? '—' : `$${num.toFixed(2)}`;
    };
    const formatPct = (n) => {
      if (n == null || n === '') return '—';
      const num = parseFloat(n);
      if (isNaN(num)) return '—';
      return (num < 1 ? num * 100 : num).toFixed(1) + '%';
    };
    const formatDate = (d) => !d ? '—' : new Date(d).toLocaleDateString();
    const rows = reportData.map((r) => {
      const premiumsText = (r.premiums && r.premiums.length)
        ? r.premiums.map((p) => `${p.premium_name || 'Premium'}: ${formatMoney(p.rate_per_hour)}/hr`).join('; ')
        : '—';
      return `<tr>
        <td>${(r.first_name || '').trim() || '—'}</td>
        <td>${(r.last_name || '').trim() || '—'}</td>
        <td>${r.employment_status || '—'}</td>
        <td>${formatMoney(r.hourly_wage)}</td>
        <td>${premiumsText}</td>
        <td>${formatDate(r.hire_date)}</td>
        <td>${r.avg_weekly_hours != null ? Number(r.avg_weekly_hours).toFixed(1) : '—'}</td>
        <td>${formatPct(r.vacation_percent)}</td>
      </tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Active Employees Report</title>
      <style>
        body{font-family:system-ui,sans-serif;font-size: 14px;padding:24px;margin:0;}
        table{border-collapse:collapse;width:100%;font-size: 14px;}
        th,td{border:1px solid #333;padding:8px 9px;text-align:left;}
        th{background:#eee;font-weight:600;}
        h1{font-size: 22px;margin:0 0 9px 0;}
        p{margin:0 0 12px 0;}
        @media print{
          body{padding:18px;margin:0;}
          table{font-size: 14px;}
          th,td{padding:6px 8px;}
          h1{font-size: 19px;}
        }
      </style></head>
      <body><h1>Active Employees Report</h1><p><strong>${businessName}</strong> — ${new Date().toLocaleString()}</p>
      <table><thead><tr><th>First name</th><th>Last name</th><th>Status</th><th>Wage</th><th>Premiums ($/hr)</th><th>Hire date</th><th>Avg hrs/wk</th><th>Vacation %</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const w = window.open('', '_blank');
    if (!w) {
      toast.error('Please allow pop-ups to print the report.');
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => {
      w.print();
      w.close();
    }, 300);
  };

  const handleViewContract = async (employee) => {
    try {
      // Find any contract for this employee (signed, pending, or sent)
      const { data: contracts, error: contractError } = await supabase
        .from('hr_contracts')
        .select('id, signing_token, status, employee_email, employee_first_name, employee_last_name')
        .eq('employee_email', employee.email)
        .in('status', ['signed', 'pending', 'sent'])
        .order('signed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (contractError) {
        console.error('Error fetching contract:', contractError);
        toast.error('Failed to load contract: ' + contractError.message);
        return;
      }

      if (!contracts || !contracts.signing_token) {
        // No contract found - show modal with upload option
        setSelectedEmployee(employee);
        setShowContractModal(true);
        return;
      }

      // Navigate to contract view page
      window.open(`/contract/view/${contracts.signing_token}`, '_blank');
    } catch (error) {
      console.error('Error viewing contract:', error);
      toast.error('Failed to open contract: ' + error.message);
    }
  };

  const handleContractUploaded = (contractRecord) => {
    // Refresh employee data or show success message
    console.log('Contract uploaded:', contractRecord);
    // Optionally reload employees to reflect the new contract
    loadEmployees();
  };

  const handleResendPersonalInfo = async (employee) => {
    try {
      if (!employee.email) {
        toast.error('Employee email is missing');
        return;
      }

      // Get or create user record
      let user = employee;
      if (!employee.id) {
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('id, email, first_name, last_name, personal_info_token')
          .eq('email', employee.email)
          .maybeSingle();
        
        if (userError && userError.code !== 'PGRST116') {
          throw new Error('Failed to load employee: ' + userError.message);
        }
        
        if (userData) {
          user = userData;
        } else {
          throw new Error('Employee not found in system. Please ensure the employee exists.');
        }
      }

      // Generate or get existing personal info token from user record
      let personalInfoToken = user.personal_info_token;
      
      if (!personalInfoToken) {
        personalInfoToken = crypto.randomUUID();
      }

      // Update user record with token (primary storage)
      // Check if column exists first (migration might not be run)
      const { error: userTokenUpdateError } = await supabase
        .from('users')
        .update({ personal_info_token: personalInfoToken })
        .eq('id', user.id);
      
      if (userTokenUpdateError) {
        // If column doesn't exist, try to use contract token only
        if (userTokenUpdateError.message?.includes('personal_info_token') || userTokenUpdateError.code === 'PGRST204') {
          console.warn('personal_info_token column not found in users table. Please run migration: add_personal_info_token_to_users.sql');
          // Continue with contract token only
        } else {
          throw new Error('Failed to generate token: ' + userTokenUpdateError.message);
        }
      }

      // Also update contract if it exists (for backwards compatibility)
      const { data: contract } = await supabase
        .from('hr_contracts')
        .select('id, business_id')
        .or(`employee_email.eq.${employee.email},employee_id.eq.${user.id}`)
        .in('status', ['employee_signed', 'signed'])
        .order('signed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (contract) {
        await supabase
          .from('hr_contracts')
          .update({ personal_info_token: personalInfoToken })
          .eq('id', contract.id);
      }

      // Get business name
      let businessName = businessData?.business_name || businessData?.name || 'Company';
      const businessId = contract?.business_id || selectedBusinessId;
      if (businessId && !businessName) {
        const { data: bizData } = await supabase
          .from('businesses')
          .select('business_name, name')
          .eq('id', businessId)
          .maybeSingle();
        if (bizData) {
          businessName = bizData.business_name || bizData.name || businessName;
        }
      }

      const frontendUrl = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
      const personalInfoLink = `${frontendUrl}/contract/personal-info/${personalInfoToken}`;
      const employeeName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Employee';

      const personalInfoEmailHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Complete Your Employee Profile</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f5f5f5;
            }
            .email-wrapper {
              background: white;
              border-radius: 8px;
              padding: 30px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .form-button {
              display: inline-block;
              background-color: #008080;
              color: white;
              padding: 15px 30px;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="email-wrapper">
            <h2>Complete Your Employee Profile</h2>
            <p>Dear ${employeeName},</p>
            <p>Please complete your personal information form to finalize your employee profile setup.</p>
            <p><strong>Please complete the form by clicking the button below:</strong></p>
            <a href="${personalInfoLink}" class="form-button" style="color: white; text-decoration: none;">Complete Personal Information Form</a>
            <p style="margin-top: 15px; font-size: 10px; color: #666;">
              Or copy and paste this link into your browser:<br>
              <a href="${personalInfoLink}" style="color: #008080; word-break: break-all;">${personalInfoLink}</a>
            </p>
            <p style="margin-top: 20px; font-size: 10px; color: #666;">
              This form includes fields for your SIN number, address, birth date, emergency contact information, and account setup (password and PIN).
            </p>
          </div>
        </body>
        </html>
      `;

      const plainTextBody = `Dear ${employeeName},

Please complete your personal information form to finalize your employee profile setup.

Please complete the form by visiting:
${personalInfoLink}

This form includes fields for your SIN number, address, birth date, emergency contact information, and account setup (password and PIN).`;

      const emailPayload = {
        businessId: businessId || selectedBusinessId,
        campaignId: `personal-info-resend-${user.id}-${Date.now()}`,
        contactId: `personal-info-${employee.email}`,
        emailType: 'transactional',
        to: employee.email,
        fromEmail: 'noreply@tavarios.ca',
        fromName: `${businessName} - HR`,
        subject: `Complete Your Employee Profile - ${employeeName}`,
        html: personalInfoEmailHTML,
        text: plainTextBody
      };

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(emailPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to send email');
      }

      const data = await response.json();
      if (!data?.ok) {
        throw new Error(data?.error || 'Failed to send email');
      }

      // Show success modal with email address
      setResendSuccessEmail(employee.email);
      setShowResendSuccessModal(true);
      
      recordAction('resend_personal_info_form', employee.id);
      await logSecurityEvent('personal_info_form_resent', {
        employee_id: employee.id,
        employee_email: employee.email,
        contract_id: contract?.id
      }, 'medium');
    } catch (error) {
      console.error('Error resending personal info form:', error);
      toast.error('Failed to resend personal info form: ' + (error.message || 'Unknown error'));
      await logSecurityEvent('personal_info_form_resend_failed', {
        employee_id: employee.id,
        employee_email: employee.email,
        error: error.message
      }, 'medium');
    }
  };

  const handleCreateContract = (employee) => {
    if (!canEditEmployees) {
      toast.error('You do not have permission to create contracts');
      return;
    }

    // Navigate to ContractManagement with employee data pre-filled
    navigate('/dashboard/hr/contracts', {
      state: {
        createContractForEmployee: {
          id: employee.id,
          firstName: employee.first_name,
          lastName: employee.last_name,
          email: employee.email,
          phone: employee.phone,
          position: employee.position,
          department: employee.department,
          address: employee.address || '',
          wage: employee.wage,
          hireDate: employee.hire_date,
          employmentStatus: employee.employment_status,
          vacationPercent: employee.vacation_percent,
          manager_id: employee.manager_id || null
        }
      }
    });
    
    recordAction('create_contract_from_employee', employee.id);
  };

  const handleTerminateEmployee = async (employee) => {
    if (!canTerminateEmployees) {
      toast.error('You do not have permission to terminate employees');
      return;
    }

    const reason = prompt(`Please provide a reason for terminating ${employee.full_name}:`);
    if (reason === null) return;
    
    const terminationDate = prompt('Enter termination date (YYYY-MM-DD) or leave blank for today:');
    if (terminationDate === null) return;
    
    const finalTerminationDate = terminationDate.trim() || new Date().toISOString().split('T')[0];
    
    if (!/^\d{4}-\d{2}-\d{2}$/.test(finalTerminationDate)) {
      toast.error('Invalid date format. Please use YYYY-MM-DD format.');
      return;
    }
    
    if (confirm(`Are you sure you want to terminate ${employee.full_name} effective ${finalTerminationDate}?`)) {
      try {
        await logSecurityEvent('employee_termination_attempt', {
          employee_id: employee.id,
          employee_name: employee.full_name,
          termination_date: finalTerminationDate,
          reason: reason
        }, 'high');
        
        const { error: updateError } = await updateBusinessEmploymentStatus(supabase, {
          userId: employee.id,
          businessId: selectedBusinessId,
          employment_status: 'terminated',
          termination_date: finalTerminationDate,
        });
        
        if (updateError) {
          console.error('Error terminating employee:', updateError);
          toast.error('Failed to terminate employee: ' + updateError.message);
          return;
        }
        
        // Soft delete: Set active to false in user_roles (so they don't appear in active employee list)
        const { error: roleError } = await supabase
          .from('user_roles')
          .update({ active: false })
          .eq('user_id', employee.id)
          .eq('business_id', selectedBusinessId);
        
        if (roleError) {
          console.warn('Error deactivating user_roles (non-critical):', roleError);
        }
        
        await logSecurityEvent('employee_terminated', {
          employee_id: employee.id,
          employee_name: employee.full_name,
          termination_date: finalTerminationDate,
          terminated_by: authUser?.id,
          reason: reason
        }, 'high');
        
        console.log('Employee terminated:', employee.id);
        recordAction('terminate_employee', employee.id);
        loadEmployees();
        
        toast.success(`${employee.full_name} has been terminated successfully.`);
        
      } catch (error) {
        console.error('Error terminating employee:', error);
        toast.error('Failed to terminate employee: ' + error.message);
      }
    }
  };

  // Filter employees
  const filteredEmployees = employees.filter(employee => {
    const matchesSearch = !searchTerm || 
      employee.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      employee.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      employee.position?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      employee.employee_number?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const statusKey = employee.lifecycle_status || employee.employment_status;
    const matchesStatus = statusFilter === 'all'
      ? true
      : statusFilter === 'active'
        ? statusKey !== 'terminated' && statusKey !== 'suspended'
        : statusKey === statusFilter;
    const matchesDepartment = departmentFilter === 'all' || employee.department === departmentFilter;
    
    const matchesPremium = premiumFilter === 'all' || 
      (premiumFilter === 'has_premiums' && employee.active_premiums.length > 0) ||
      (premiumFilter === 'no_premiums' && employee.active_premiums.length === 0) ||
      employee.active_premiums.some(p => p.premium.id === premiumFilter);
    
    return matchesSearch && matchesStatus && matchesDepartment && matchesPremium;
  }).sort((a, b) => {
    // Sort alphabetically by full name
    const nameA = (a.full_name || '').toLowerCase();
    const nameB = (b.full_name || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  // Get employee statistics
  const stats = {
    total: employees.length,
    active: employees.filter(e => e.employment_status !== 'terminated').length,
    probation: employees.filter((e) => e.lifecycle_status === 'probation').length,
    pending: employees.filter((e) => e.lifecycle_status === 'pending').length,
    recent: employees.filter(e => e.hire_date && new Date(e.hire_date) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).length,
    with_premiums: employees.filter(e => e.active_premiums.length > 0).length,
    with_certificates: employees.filter(e => e.active_certificates.length > 0).length,
    with_lieu_time: employees.filter(e => e.lieu_time_enabled).length,
    lieu_time_warnings: employees.filter(e => e.lieu_time_enabled && e.lieu_time_balance >= 40).length
  };

  // Styles using TavariStyles
  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      padding: '20px',
      paddingTop: '0px',
      boxSizing: 'border-box'
    },
    header: {
      marginBottom: '5px',
      textAlign: 'center'
    },
    headerH2: {
      marginTop: '0',
      marginBottom: '8px'
    },
    headerP: {
      marginTop: '0',
      marginBottom: '0'
    },
    errorBanner: {
      ...TavariStyles.components.banner?.base,
      ...TavariStyles.components.banner?.variants?.error,
      position: 'relative'
    },
    errorClose: {
      position: 'absolute',
      right: '15px',
      background: 'none',
      border: 'none',
      color: TavariStyles.colors.danger,
      cursor: 'pointer'
    },
    stats: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing['3xl']
    },
    statCard: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.xl,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      textAlign: 'center',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
    },
    statValue: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      marginBottom: TavariStyles.spacing.sm
    },
    statLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    controls: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing['3xl'],
      gap: TavariStyles.spacing.xl,
      flexWrap: 'wrap'
    },
    searchSection: {
      display: 'flex',
      gap: TavariStyles.spacing.lg,
      flex: 1,
      flexWrap: 'wrap',
      minWidth: 0
    },
    searchGroup: {
      position: 'relative',
      flex: '1 1 300px',
      minWidth: '200px',
      maxWidth: '500px'
    },
    searchIcon: {
      position: 'absolute',
      left: TavariStyles.spacing.md,
      top: '50%',
      transform: 'translateY(-50%)',
      color: TavariStyles.colors.gray500
    },
    searchInput: {
      ...TavariStyles.components.form?.input,
      width: '100%',
      paddingLeft: '40px'
    },
    filterGroup: {
      position: 'relative',
      minWidth: '150px'
    },
    filterIcon: {
      position: 'absolute',
      left: TavariStyles.spacing.md,
      top: '50%',
      transform: 'translateY(-50%)',
      color: TavariStyles.colors.gray500,
      zIndex: 1
    },
    filterSelect: {
      ...TavariStyles.components.form?.select,
      width: '100%',
      paddingLeft: '40px'
    },
    createButton: {
      ...TavariStyles.components.button?.base,
      ...TavariStyles.components.button?.variants?.primary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      whiteSpace: 'nowrap',
      flexShrink: 0
    },
    content: {
      marginBottom: TavariStyles.spacing['3xl']
    },
    emptyState: {
      textAlign: 'center',
      padding: '60px 20px',
      color: TavariStyles.colors.gray500
    },
    emptyIcon: {
      color: TavariStyles.colors.gray400,
      marginBottom: TavariStyles.spacing.xl
    },
    emptyTitle: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.md,
      color: TavariStyles.colors.gray700
    },
    emptyText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      marginBottom: TavariStyles.spacing['3xl']
    },
    employeeGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr',
      gap: TavariStyles.spacing.xl,
      paddingBottom: TavariStyles.spacing.xl
    },
    loading: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '200px',
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    }
  };

  const reportTableHeader = {
    border: `1px solid ${TavariStyles.colors.gray300}`,
    padding: '8px 10px',
    textAlign: 'left',
    backgroundColor: TavariStyles.colors.gray100,
    fontWeight: TavariStyles.typography.fontWeight.semibold
  };
  const reportTableCell = {
    border: `1px solid ${TavariStyles.colors.gray200}`,
    padding: '8px 10px'
  };

  // Loading states
  if (permissionsLoading || authLoading) {
    return (
      <div style={{ ...styles.container, justifyContent: 'center', alignItems: 'center', display: 'flex' }}>
        <div style={styles.loading}>Loading Employee Profiles...</div>
      </div>
    );
  }

  // FIX: Also check isOwner() and userRole directly as fallback
  const isUserOwner = isOwner() || userRole === 'owner';
  const finalCanViewEmployees = canViewEmployees || isUserOwner;
  
  if (!finalCanViewEmployees) {
    return (
      <div style={{ ...styles.container, justifyContent: 'center', alignItems: 'center', display: 'flex', flexDirection: 'column' }}>
        <AlertCircle size={48} style={{ color: TavariStyles.colors.danger, marginBottom: '16px' }} />
        <h3>Access Denied</h3>
        <p>You do not have permission to view employee profiles</p>
        <button
          onClick={() => navigate('/dashboard/hr/dashboard')}
          style={{ ...styles.createButton, marginTop: '20px' }}
        >
          Return to HR Dashboard
        </button>
      </div>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'admin']}
      requireBusiness={true}
      componentName="EmployeeProfiles"
    >
      <SecurityWrapper>
        <div style={styles.container}>
          <div style={styles.header}>
            <h2 style={styles.headerH2}>Employee Profiles</h2>
            <p style={styles.headerP}>Manage employee information, premiums, certificates, lieu time, and view change history</p>
          </div>

          {error && (
            <div style={styles.errorBanner}>
              <AlertCircle size={20} style={{ marginRight: '8px' }} />
              {error}
              <button
                onClick={() => setError(null)}
                style={styles.errorClose}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* Active employees report modal */}
          {reportModalOpen && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                padding: 24
              }}
              onClick={(e) => e.target === e.currentTarget && setReportModalOpen(false)}
            >
              <div
                style={{
                  backgroundColor: TavariStyles.colors.white,
                  borderRadius: TavariStyles.borderRadius?.md || '8px',
                  maxWidth: 960,
                  width: '100%',
                  maxHeight: '90vh',
                  overflow: 'auto',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
                  padding: TavariStyles.spacing.xl
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0 }}>Active employees report</h3>
                  <button
                    type="button"
                    onClick={() => setReportModalOpen(false)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
                  >
                    <X size={24} />
                  </button>
                </div>
                {reportLoading && <div style={styles.loading}>Loading report…</div>}
                {reportError && (
                  <div style={{ ...styles.errorBanner, marginBottom: 16 }}>
                    {reportError}
                  </div>
                )}
                {!reportLoading && reportData.length > 0 && (
                  <>
                    <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr>
                            <th style={reportTableHeader}>First name</th>
                            <th style={reportTableHeader}>Last name</th>
                            <th style={reportTableHeader}>Status</th>
                            <th style={reportTableHeader}>Hourly wage</th>
                            <th style={reportTableHeader}>Premiums ($/hr)</th>
                            <th style={reportTableHeader}>Hire date</th>
                            <th style={reportTableHeader}>Avg weekly hrs</th>
                            <th style={reportTableHeader}>Vacation %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.map((r, i) => (
                            <tr key={i}>
                              <td style={reportTableCell}>{r.first_name || '—'}</td>
                              <td style={reportTableCell}>{r.last_name || '—'}</td>
                              <td style={reportTableCell}>{r.employment_status || '—'}</td>
                              <td style={reportTableCell}>
                                {r.hourly_wage != null && r.hourly_wage !== '' ? `$${Number(r.hourly_wage).toFixed(2)}` : '—'}
                              </td>
                              <td style={reportTableCell}>
                                {r.premiums?.length
                                  ? r.premiums.map((p) => `${p.premium_name || 'Premium'}: $${Number(p.rate_per_hour || 0).toFixed(2)}/hr`).join('; ')
                                  : '—'}
                              </td>
                              <td style={reportTableCell}>
                                {r.hire_date ? new Date(r.hire_date).toLocaleDateString() : '—'}
                              </td>
                              <td style={reportTableCell}>
                                {r.avg_weekly_hours != null ? Number(r.avg_weekly_hours).toFixed(1) : '—'}
                              </td>
                              <td style={reportTableCell}>
                                {r.vacation_percent != null && r.vacation_percent !== ''
                                  ? (Number(r.vacation_percent) < 1 ? Number(r.vacation_percent) * 100 : Number(r.vacation_percent)).toFixed(1) + '%'
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => setReportModalOpen(false)}
                        style={{ ...styles.createButton, ...TavariStyles.components?.button?.variants?.secondary }}
                      >
                        Close
                      </button>
                      <button type="button" onClick={handlePrintReport} style={styles.createButton}>
                        <Printer size={18} style={{ marginRight: 6 }} />
                        Print
                      </button>
                    </div>
                  </>
                )}
                {!reportLoading && !reportError && reportData.length === 0 && (
                  <p style={{ color: TavariStyles.colors.gray600 }}>No active employees to show.</p>
                )}
              </div>
            </div>
          )}

          {/* Stats section */}
          <div style={styles.stats}>
            <div style={styles.statCard}>
              <div style={styles.statValue}>{stats.total}</div>
              <div style={styles.statLabel}>Total Employees</div>
            </div>
            <div style={styles.statCard}>
              <div style={{...styles.statValue, color: TavariStyles.colors.success}}>{stats.active}</div>
              <div style={styles.statLabel}>Active</div>
            </div>
            <div style={styles.statCard}>
              <div style={{...styles.statValue, color: TavariStyles.colors.warning}}>{stats.probation}</div>
              <div style={styles.statLabel}>On Probation</div>
            </div>
            <div style={styles.statCard}>
              <div style={{...styles.statValue, color: TavariStyles.colors.info}}>{stats.recent}</div>
              <div style={styles.statLabel}>Hired (Last 30 Days)</div>
            </div>
            {canManagePremiums && (
              <div style={styles.statCard}>
                <div style={{...styles.statValue, color: TavariStyles.colors.success}}>{stats.with_premiums}</div>
                <div style={styles.statLabel}>With Premiums</div>
              </div>
            )}
            {canManageCertificates && (
              <div style={styles.statCard}>
                <div style={{...styles.statValue, color: TavariStyles.colors.info}}>{stats.with_certificates}</div>
                <div style={styles.statLabel}>With Certificates</div>
              </div>
            )}
            {canManageLieuTime && (
              <div style={styles.statCard}>
                <div style={{...styles.statValue, color: TavariStyles.colors.primary}}>{stats.with_lieu_time}</div>
                <div style={styles.statLabel}>With Lieu Time</div>
              </div>
            )}
            {canManageLieuTime && stats.lieu_time_warnings > 0 && (
              <div style={styles.statCard}>
                <div style={{...styles.statValue, color: TavariStyles.colors.warning}}>{stats.lieu_time_warnings}</div>
                <div style={styles.statLabel}>High Lieu Balance</div>
              </div>
            )}
          </div>

          {/* Controls section */}
          <div style={styles.controls}>
            <div style={styles.searchSection}>
              <div style={styles.searchGroup}>
                <Search size={20} style={styles.searchIcon} />
                <input
                  type="text"
                  placeholder="Search employees by name, email, position, or employee #..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={styles.searchInput}
                />
              </div>
              
              <div style={styles.filterGroup}>
                <Filter size={20} style={styles.filterIcon} />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={styles.filterSelect}
                >
                  <option value="all">All Status</option>
                  <option value="active">Current (excl. terminated)</option>
                  <option value="pending">Pending Contract</option>
                  <option value="probation">Probation</option>
                  <option value="suspended">Suspended</option>
                  <option value="terminated">Terminated</option>
                  <option value="on_leave">On Leave</option>
                </select>
              </div>

              <div style={styles.filterGroup}>
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  style={styles.filterSelect}
                >
                  <option value="all">All Departments</option>
                  {departments.map(dept => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>

              {canManagePremiums && (
                <div style={styles.filterGroup}>
                  <select
                    value={premiumFilter}
                    onChange={(e) => setPremiumFilter(e.target.value)}
                    style={styles.filterSelect}
                  >
                    <option value="all">All Premiums</option>
                    <option value="has_premiums">Has Premiums</option>
                    <option value="no_premiums">No Premiums</option>
                    {availablePremiums.map(premium => (
                      <option key={premium.id} value={premium.id}>
                        {premium.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            
            {finalCanViewEmployees && (
              <button
                onClick={handleOpenReportModal}
                style={{
                  ...styles.createButton,
                  ...TavariStyles.components.button?.variants?.secondary,
                  backgroundColor: TavariStyles.colors?.gray100 ?? '#f3f4f6',
                  color: TavariStyles.colors?.gray800 ?? '#1f2937'
                }}
              >
                <Printer size={20} />
                Print active employees
              </button>
            )}
            <PermissionGate permissions={['hr.employees.create']} requireElevated>
              <button
                onClick={() => setShowAddModal(true)}
                style={styles.createButton}
              >
                <Plus size={20} />
                Add Employee
              </button>
            </PermissionGate>
          </div>

          {/* Content section */}
          <div style={styles.content}>
            {loading ? (
              <div style={styles.loading}>Loading employee profiles...</div>
            ) : filteredEmployees.length === 0 ? (
              <div style={styles.emptyState}>
                <Users size={64} style={styles.emptyIcon} />
                <h3 style={styles.emptyTitle}>No employees found</h3>
                <p style={styles.emptyText}>
                  {searchTerm || statusFilter !== 'all' || departmentFilter !== 'all' || premiumFilter !== 'all'
                    ? 'Try adjusting your search filters.'
                    : 'Get started by adding your first employee.'
                  }
                </p>
                <PermissionGate permissions={['hr.employees.create']} requireElevated>
                  {!searchTerm && statusFilter === 'all' && departmentFilter === 'all' && premiumFilter === 'all' && (
                    <button
                      onClick={() => setShowAddModal(true)}
                      style={styles.createButton}
                    >
                      Add First Employee
                    </button>
                  )}
                </PermissionGate>
              </div>
            ) : (
              <div style={styles.employeeGrid}>
                {filteredEmployees.map((employee) => (
                  <EmployeeCard
                    key={employee.id}
                    employee={employee}
                    businessId={selectedBusinessId}
                    formatTaxAmount={formatTaxAmount}
                    canManageEmployees={() => canEditEmployees}
                    canViewAuditHistory={() => canViewAudit}
                    onEditEmployee={handleEditEmployee}
                    onManagePremiums={handleManagePremiums}
                    onManageCertificates={handleManageCertificates}
                    onManageLieuTime={handleManageLieuTime}
                    onManageVacationPay={handleManageVacationPay}
                    onViewAuditHistory={handleViewAuditHistory}
                    onTerminateEmployee={handleTerminateEmployee}
                    onDeleteEmployee={handleDeleteEmployee}
                    onManageBirthday={handleManageBirthday}
                    onManageSIN={handleManageSIN}
                    onToggleStudentPay={handleToggleStudentPay}
                    onViewContract={handleViewContract}
                    onCreateContract={handleCreateContract}
                    onResendPersonalInfo={handleResendPersonalInfo}
                  />
                ))}
              </div>
            )}
          </div>

          {/* MODALS */}
          <PermissionGate permissions={['hr.employees.create']} requireElevated>
            <AddEmployeeModal
              isOpen={showAddModal}
              onClose={() => setShowAddModal(false)}
              businessId={selectedBusinessId}
              onEmployeeCreated={handleEmployeeCreated}
              userContext={userContext}
              mode="create"
              availablePremiums={availablePremiums}
              availableCertificates={availableCertificates}
            />
          </PermissionGate>

          <PermissionGate permissions={['hr.employees.edit']} requireElevated>
            <EmployeeEditModal
              isOpen={showEditModal}
              employee={selectedEmployee}
              userContext={userContext}
              onClose={() => {
                setShowEditModal(false);
                setSelectedEmployee(null);
              }}
              onSave={handleEmployeeSaved}
              mode="edit"
              availablePremiums={availablePremiums}
              availableCertificates={availableCertificates}
            />
          </PermissionGate>

          <PermissionGate permissions={['hr.audit.view']} requireElevated>
            <EmployeeAuditHistory
              isOpen={showAuditHistory}
              employee={selectedEmployee}
              userContext={userContext}
              onClose={() => {
                setShowAuditHistory(false);
                setSelectedEmployee(null);
              }}
            />
          </PermissionGate>

          <PermissionGate permissions={['hr.premiums.manage']} requireElevated>
            <EmployeePremiumAssignmentModal
              isOpen={showPremiumAssignment}
              onClose={() => {
                setShowPremiumAssignment(false);
                setSelectedEmployee(null);
              }}
              employee={selectedEmployee}
              availablePremiums={availablePremiums}
              onPremiumsUpdated={loadEmployees}
            />
          </PermissionGate>

          <PermissionGate permissions={['hr.certificates.manage']} requireElevated>
            <EmployeeCertificateManagementModal
              isOpen={showCertificateManagement}
              onClose={() => {
                setShowCertificateManagement(false);
                setSelectedEmployee(null);
              }}
              employee={selectedEmployee}
              availableCertificates={availableCertificates}
              onCertificatesUpdated={loadEmployees}
            />
          </PermissionGate>

          <PermissionGate permissions={['hr.lieu_time.manage']} requireElevated>
            <EmployeeLieuTimeTrackingModal
              isOpen={showLieuTimeModal}
              onClose={() => {
                setShowLieuTimeModal(false);
                setSelectedEmployee(null);
              }}
              employee={selectedEmployee}
              businessId={selectedBusinessId}
              onBalanceUpdate={(newBalance) => {
                if (selectedEmployee) {
                  const updatedEmployees = employees.map(emp => 
                    emp.id === selectedEmployee.id ? { ...emp, lieu_time_balance: newBalance } : emp
                  );
                  setEmployees(updatedEmployees);
                  setSelectedEmployee(prev => ({ ...prev, lieu_time_balance: newBalance }));
                }
              }}
            />
          </PermissionGate>

          <PermissionGate permissions={['hr.vacation_pay.manage']} requireElevated>
            <EmployeeVacationPayModal
              isOpen={showVacationPayModal}
              onClose={() => {
                setShowVacationPayModal(false);
                setSelectedEmployee(null);
              }}
              employee={selectedEmployee}
              businessId={selectedBusinessId}
              onVacationPayUpdated={handleVacationPayUpdated}
            />
          </PermissionGate>

          <PermissionGate permissions={['hr.sensitive_data.view']} requireOwner>
            <EmployeeBirthdayManager
              isOpen={showBirthdayManager}
              onClose={() => {
                setShowBirthdayManager(false);
                setSelectedEmployee(null);
              }}
              employee={selectedEmployee}
              businessId={selectedBusinessId}
              onBirthdayUpdated={handleBirthdayUpdated}
            />
          </PermissionGate>

          <PermissionGate permissions={['hr.sensitive_data.view']} requireOwner>
            <EmployeeSINManager
              isOpen={showSINManager}
              onClose={() => {
                setShowSINManager(false);
                setSelectedEmployee(null);
              }}
              employee={selectedEmployee}
              businessId={selectedBusinessId}
              authUser={authUser}
              onSINUpdated={handleSINUpdated}
            />
          </PermissionGate>

          <PermissionGate permissions={['hr.wages.manage']} requireElevated>
            <EmployeeStudentPaySettings
              isOpen={showStudentPaySettings}
              onClose={() => {
                setShowStudentPaySettings(false);
                setSelectedEmployee(null);
              }}
              employee={selectedEmployee}
              businessId={selectedBusinessId}
              businessSettings={businessData}
              authUser={authUser}
              onStudentPayUpdated={handleStudentPayUpdated}
            />
          </PermissionGate>

          <EmployeeContractModal
            isOpen={showContractModal}
            onClose={() => {
              setShowContractModal(false);
              setSelectedEmployee(null);
            }}
            employee={selectedEmployee}
            businessId={selectedBusinessId}
            authUser={authUser}
            onContractUploaded={handleContractUploaded}
          />

          {/* Resend Personal Info Form Success Modal */}
          {showResendSuccessModal && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000
            }}>
              <div style={{
                backgroundColor: TavariStyles.colors.white,
                borderRadius: TavariStyles.borderRadius?.lg || '12px',
                padding: TavariStyles.spacing.xl,
                maxWidth: '500px',
                width: '90%',
                boxShadow: TavariStyles.shadows?.xl || '0 20px 60px rgba(0,0,0,0.3)'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: TavariStyles.spacing.lg
                }}>
                  <h3 style={{
                    fontSize: TavariStyles.typography.fontSize.xl,
                    fontWeight: TavariStyles.typography.fontWeight.bold,
                    color: TavariStyles.colors.gray900,
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: TavariStyles.spacing.sm
                  }}>
                    <CheckCircle size={24} style={{ color: TavariStyles.colors.success }} />
                    Email Sent Successfully
                  </h3>
                  <button
                    onClick={() => {
                      setShowResendSuccessModal(false);
                      setResendSuccessEmail('');
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      color: TavariStyles.colors.gray600
                    }}
                  >
                    <X size={24} />
                  </button>
                </div>

                <div style={{
                  marginBottom: TavariStyles.spacing.lg
                }}>
                  <p style={{
                    fontSize: TavariStyles.typography.fontSize.base,
                    color: TavariStyles.colors.gray700,
                    marginBottom: TavariStyles.spacing.md
                  }}>
                    The personal information form has been sent successfully.
                  </p>
                  
                  <div style={{
                    backgroundColor: TavariStyles.colors.gray50,
                    borderRadius: TavariStyles.borderRadius?.md || '8px',
                    padding: TavariStyles.spacing.md,
                    display: 'flex',
                    alignItems: 'center',
                    gap: TavariStyles.spacing.sm
                  }}>
                    <Mail size={20} style={{ color: TavariStyles.colors.primary }} />
                    <div>
                      <div style={{
                        fontSize: TavariStyles.typography.fontSize.sm,
                        color: TavariStyles.colors.gray600,
                        marginBottom: '4px'
                      }}>
                        Sent to:
                      </div>
                      <div style={{
                        fontSize: TavariStyles.typography.fontSize.base,
                        fontWeight: TavariStyles.typography.fontWeight.medium,
                        color: TavariStyles.colors.gray900
                      }}>
                        {resendSuccessEmail}
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setShowResendSuccessModal(false);
                    setResendSuccessEmail('');
                  }}
                  style={{
                    width: '100%',
                    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
                    backgroundColor: TavariStyles.colors.primary,
                    color: TavariStyles.colors.white,
                    border: 'none',
                    borderRadius: TavariStyles.borderRadius?.md || '8px',
                    fontSize: TavariStyles.typography.fontSize.base,
                    fontWeight: TavariStyles.typography.fontWeight.semibold,
                    cursor: 'pointer'
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default EmployeeProfiles;