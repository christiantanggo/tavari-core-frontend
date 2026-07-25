// src/screens/EmployeeScreen.jsx - WITH PERMISSION SYSTEM
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

// Import all required consistency files
import { SecurityWrapper } from '../Security';
import { useSecurityContext } from '../Security';
import { usePOSAuth } from '../hooks/usePOSAuth';
import { useTaxCalculations } from '../hooks/useTaxCalculations';
import { usePermissions } from '../hooks/usePermissions';
import POSAuthWrapper from '../components/Auth/POSAuthWrapper';
import PermissionGate from '../components/Auth/PermissionGate';
import TavariCheckbox from '../components/UI/TavariCheckbox';
import TavariModuleHeader from '../components/UI/TavariModuleHeader';
import { TavariStyles } from '../utils/TavariStyles';
import toast from 'react-hot-toast';

// Modals
import AddEmployeeModal from '../components/HR/AddEmployeeModal';
import PositionLabel from '../components/HR/PositionLabel';
import FixEmployeeAuthModal from '../components/HR/FixEmployeeAuthModal';

import SessionManager from '../components/SessionManager';
import RoleManagementTab from '../components/Settings/RoleManagementTab';

/** PostgREST may return embedded FK rows as an array or object depending on relation cardinality. */
function roleFromBusinessUsersJoin(user) {
  const bu = user.business_users;
  if (!bu) return null;
  if (Array.isArray(bu)) return bu[0]?.role ?? null;
  return bu.role ?? null;
}

function roleFromUserRolesJoin(user) {
  const ur = user.user_roles;
  if (!ur) return null;
  if (Array.isArray(ur)) return ur[0]?.role ?? null;
  return ur.role ?? null;
}

const EMPLOYEES_MOBILE_MQ = '(max-width: 768px)';

const EmployeeScreen = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('directory'); // 'directory' | 'roles' (position & hierarchy: HR module → Employee Management → Position Management)

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showFixAuthModal, setShowFixAuthModal] = useState(false);
  const [selectedEmployeeForFix, setSelectedEmployeeForFix] = useState(null);
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(EMPLOYEES_MOBILE_MQ).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(EMPLOYEES_MOBILE_MQ);
    const onChange = () => setIsNarrowViewport(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Security context for sensitive employee data
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'EmployeeScreen',
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
    componentName: 'EmployeeScreen'
  });

  // Tax calculations for formatting
  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId);

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks
  const canViewEmployees = hasPermission('hr.employees.view') || hasElevatedPrivileges();
  const canAddEmployees = hasPermission('hr.employees.add') || hasElevatedPrivileges();
  const canEditEmployees = hasPermission('hr.employees.edit') || hasElevatedPrivileges();
  const canViewWages = hasPermission('hr.wages.view') || isOwner();
  const canFixAuth = hasPermission('hr.employees.fix_auth') || hasElevatedPrivileges();
  const canManageRoles = hasPermission('admin.roles.view') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewEmployees) {
      toast.error('You do not have permission to view employees');
      navigate('/dashboard');
    }
  }, [permissionsLoading, canViewEmployees]);

  // Load employees
  useEffect(() => {
    if (selectedBusinessId && !authLoading && !permissionsLoading && canViewEmployees) {
      fetchEmployees();
    }
  }, [selectedBusinessId, authLoading, permissionsLoading, canViewEmployees]);

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      setError(null);
      
      await recordAction('employee_list_view', true, selectedBusinessId);
      
      await logSecurityEvent('employee_data_access', {
        action: 'load_employee_list',
        business_id: selectedBusinessId,
        viewer_role: userRole
      }, 'low');
      
      // Query employees - check both business_users and user_roles to catch employees from contracts
      // First try business_users (primary link)
      const { data: userDataFromBusiness, error: businessUserError } = await supabase
        .from('users')
        .select(`
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
          created_at,
          business_users!inner(business_id, role)
        `)
        .eq('business_users.business_id', selectedBusinessId)
        .order('first_name');

      // Also check user_roles for employees who might not have business_users entry yet
      const { data: userDataFromRoles, error: roleUserError } = await supabase
        .from('users')
        .select(`
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
          created_at,
          user_roles!inner(business_id, role, active)
        `)
        .eq('user_roles.business_id', selectedBusinessId)
        .eq('user_roles.active', true)
        .order('first_name');

      // Merge results, prioritizing business_users entries, avoiding duplicates
      const userDataMap = new Map();
      const employeesMissingBusinessUsers = []; // Track employees that need business_users entry created
      
      // Add employees from business_users
      (userDataFromBusiness || []).forEach(user => {
        userDataMap.set(user.id, {
          ...user,
          role: roleFromBusinessUsersJoin(user) || 'employee',
          source: 'business_users',
        });
      });

      // Merge user_roles: same precedence as usePermissions (user_roles wins when both exist)
      (userDataFromRoles || []).forEach(user => {
        const urRole = roleFromUserRolesJoin(user) || 'employee';
        if (!userDataMap.has(user.id)) {
          userDataMap.set(user.id, {
            ...user,
            role: urRole,
            source: 'user_roles',
            business_users: { business_id: selectedBusinessId, role: urRole },
          });
          employeesMissingBusinessUsers.push({ id: user.id, email: user.email, role: urRole });
        } else {
          const existing = userDataMap.get(user.id);
          userDataMap.set(user.id, {
            ...existing,
            role: urRole,
          });
        }
      });

      const userData = Array.from(userDataMap.values());
      const userError = businessUserError || roleUserError;

      // If we found employees from user_roles but not business_users, create the missing entries
      if (employeesMissingBusinessUsers.length > 0) {
        console.log(`🔧 Found ${employeesMissingBusinessUsers.length} employees with user_roles but missing business_users entries. Creating missing entries...`);
        for (const emp of employeesMissingBusinessUsers) {
          try {
            const { error: insertError } = await supabase
              .from('business_users')
              .insert({
                user_id: emp.id,
                business_id: selectedBusinessId,
                role: emp.role
              });
            if (insertError && insertError.code !== '23505') { // Ignore duplicate key errors
              console.warn(`⚠️ Failed to create business_users entry for employee ${emp.email}:`, insertError);
            } else if (!insertError) {
              console.log(`✅ Created missing business_users entry for employee: ${emp.email}`);
            }
          } catch (err) {
            console.warn(`⚠️ Error creating business_users entry for employee ${emp.email}:`, err);
          }
        }
      }

      if (userError) {
        console.error('Error fetching employees:', userError);
        // Continue with what we have, but log the error
      }

      // Transform the data to match expected format
      const transformedEmployees = (userData || []).map(user => {
        return {
          id: user.id,
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
          wage: user.wage,
          employee_number: user.employee_number,
          created_at: user.created_at,
          role:
            user.role ||
            roleFromUserRolesJoin(user) ||
            roleFromBusinessUsersJoin(user) ||
            'employee',
          business_name: businessData?.name || 'Current Business',
          tenure: user.hire_date ? calculateTenure(user.hire_date) : null
        };
      });
      
      setEmployees(transformedEmployees);
      
      await logSecurityEvent('employee_list_loaded', {
        business_id: selectedBusinessId,
        employee_count: transformedEmployees.length
      }, 'low');
      
    } catch (error) {
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

  const calculateTenure = (hireDate) => {
    if (!hireDate) return null;
    
    const hire = new Date(hireDate);
    const now = new Date();
    const diffTime = Math.abs(now - hire);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 30) {
      return `${diffDays} days`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months !== 1 ? 's' : ''}`;
    } else {
      const years = Math.floor(diffDays / 365);
      const remainingMonths = Math.floor((diffDays % 365) / 30);
      return `${years} year${years !== 1 ? 's' : ''}${remainingMonths > 0 ? `, ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}` : ''}`;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return TavariStyles.colors.success;
      case 'probation': return TavariStyles.colors.warning;
      case 'suspended': return TavariStyles.colors.danger;
      case 'terminated': return TavariStyles.colors.gray500;
      case 'on_leave': return TavariStyles.colors.info;
      default: return TavariStyles.colors.gray500;
    }
  };

  const handleEmployeeClick = async (employee) => {
    if (!canEditEmployees) {
      toast.error('You do not have permission to view employee details');
      return;
    }

    const rateLimitRes = await checkRateLimit('employee_view');
    if (!rateLimitRes?.allowed) {
      toast.error('Too many requests. Please wait a moment.');
      return;
    }

    await recordAction('view_employee_details', true, employee.id);
    
    await logSecurityEvent('employee_details_navigation', {
      employee_id: employee.id,
      employee_name: employee.full_name,
      business_id: selectedBusinessId
    }, 'low');

    navigate(`/dashboard/employee/${employee.id}`);
  };

  const handleAddEmployee = async () => {
    if (!canAddEmployees) {
      toast.error('You do not have permission to add employees');
      return;
    }

    const rateLimitRes = await checkRateLimit('add_employee_modal');
    if (!rateLimitRes?.allowed) {
      toast.error('Too many requests. Please wait a moment.');
      return;
    }

    await recordAction('open_add_employee_modal', true, null);
    
    await logSecurityEvent('add_employee_modal_opened', {
      business_id: selectedBusinessId,
      opened_by: authUser?.id
    }, 'low');

    setShowAddModal(true);
  };

  const handleEmployeeCreated = async (newEmployeeId) => {
    setShowAddModal(false);
    
    await logSecurityEvent('employee_created_from_screen', {
      new_employee_id: newEmployeeId,
      business_id: selectedBusinessId,
      created_by: authUser?.id
    }, 'medium');

    await recordAction('employee_created_success', true, newEmployeeId);
    
    toast.success('Employee created successfully');
    fetchEmployees(); // Reload the list
  };
  
  const handleFixAuth = async (employee) => {
    if (!canFixAuth) {
      toast.error('You do not have permission to fix authentication');
      return;
    }

    const rateLimitRes = await checkRateLimit('fix_auth_modal');
    if (!rateLimitRes?.allowed) {
      toast.error('Too many requests. Please wait.');
      return;
    }

    await recordAction('fix_employee_auth', true, employee.id);
    
    await logSecurityEvent('fix_auth_modal_opened', {
      employee_id: employee.id,
      employee_email: employee.email,
      business_id: selectedBusinessId,
      initiated_by: authUser?.id
    }, 'high');

    setSelectedEmployeeForFix(employee);
    setShowFixAuthModal(true);
  };

  const handleFixAuthSuccess = async () => {
    await logSecurityEvent('fix_auth_completed', {
      employee_id: selectedEmployeeForFix?.id,
      business_id: selectedBusinessId,
      fixed_by: authUser?.id
    }, 'high');

    setShowFixAuthModal(false);
    setSelectedEmployeeForFix(null);
    toast.success('Authentication fixed successfully');
    fetchEmployees(); // Refresh the employee list
  };

  const handleViewContract = async (employee) => {
    if (!canEditEmployees) {
      toast.error('You do not have permission to view contracts');
      return;
    }

    try {
      // Find the signed contract for this employee
      const { data: contracts, error: contractError } = await supabase
        .from('hr_contracts')
        .select('id, signing_token, status, employee_email, employee_first_name, employee_last_name')
        .eq('employee_email', employee.email)
        .eq('status', 'signed')
        .order('signed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (contractError) {
        console.error('Error fetching contract:', contractError);
        toast.error('Failed to load contract: ' + contractError.message);
        return;
      }

      if (!contracts || !contracts.signing_token) {
        toast.error('No signed contract found for this employee');
        return;
      }

      // Navigate to contract view page
      window.open(`/contract/view/${contracts.signing_token}`, '_blank');
    } catch (error) {
      console.error('Error viewing contract:', error);
      toast.error('Failed to open contract: ' + error.message);
    }
  };

  // Filter employees based on search
  const filteredEmployees = employees.filter(emp =>
    emp.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    emp.email?.toLowerCase().includes(search.toLowerCase()) ||
    emp.position?.toLowerCase().includes(search.toLowerCase()) ||
    emp.department?.toLowerCase().includes(search.toLowerCase()) ||
    emp.employee_number?.toLowerCase().includes(search.toLowerCase())
  );

  // Enhanced styles using TavariStyles
  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      padding: isNarrowViewport ? '12px 14px 24px' : TavariStyles.spacing['3xl'],
      paddingTop: isNarrowViewport ? '68px' : '80px',
      boxSizing: 'border-box',
      maxWidth: '100%',
      overflowX: 'hidden',
    },
    header: {
      marginBottom: TavariStyles.spacing['3xl'],
      textAlign: 'center'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },
    headerRow: {
      display: 'flex',
      flexDirection: isNarrowViewport ? 'column' : 'row',
      gap: isNarrowViewport ? TavariStyles.spacing.md : TavariStyles.spacing.lg,
      marginBottom: isNarrowViewport ? TavariStyles.spacing.xl : TavariStyles.spacing['3xl'],
      alignItems: isNarrowViewport ? 'stretch' : 'center',
    },
    searchInput: {
      ...TavariStyles.components.form?.input,
      flex: isNarrowViewport ? 'none' : 3,
      width: isNarrowViewport ? '100%' : undefined,
      minWidth: 0,
      boxSizing: 'border-box',
      fontSize: TavariStyles.typography.fontSize.md
    },
    addButton: {
      ...TavariStyles.components.button?.base,
      ...TavariStyles.components.button?.variants?.primary,
      flex: 1,
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.sm
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
    },
    gridContainer: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      overflow: isNarrowViewport ? 'visible' : 'hidden',
      boxShadow: TavariStyles.shadows?.base || '0 2px 4px rgba(0,0,0,0.1)',
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    gridHeader: {
      display: 'grid',
      gridTemplateColumns: '2fr 2fr 1.5fr 1.5fr 1fr 1fr 1fr 1fr',
      backgroundColor: TavariStyles.colors.gray100,
      padding: TavariStyles.spacing.lg,
      borderBottom: `2px solid ${TavariStyles.colors.gray200}`,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      textTransform: 'uppercase',
      letterSpacing: '0.05em'
    },
    gridRow: {
      display: 'grid',
      gridTemplateColumns: '2fr 2fr 1.5fr 1.5fr 1fr 1fr 1fr 1fr',
      padding: TavariStyles.spacing.lg,
      borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
      cursor: 'pointer',
      transition: 'background-color 0.2s ease',
      fontSize: TavariStyles.typography.fontSize.sm,
      alignItems: 'center'
    },
    gridRowHover: {
      backgroundColor: TavariStyles.colors.gray50
    },
    link: {
      color: TavariStyles.colors.primary,
      textDecoration: 'none',
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },
    statusBadge: {
      padding: '4px 8px',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      textAlign: 'center',
      textTransform: 'uppercase'
    },
    employeeNumber: {
      fontFamily: TavariStyles.typography.fontFamilyMono,
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      backgroundColor: TavariStyles.colors.gray100,
      padding: '2px 6px',
      borderRadius: TavariStyles.borderRadius?.sm || '4px'
    },
    wage: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.primary
    },
    fixAuthButton: {
      backgroundColor: '#ff9800',
      color: 'white',
      border: 'none',
      padding: '6px 12px',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: 'bold',
      transition: 'background-color 0.2s ease'
    },
    emptyState: {
      textAlign: 'center',
      padding: '60px 20px',
      color: TavariStyles.colors.gray500
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
    loading: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '200px',
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },
    /** Mobile directory: tap a name to open profile (details live on employee page). */
    mobileNameList: {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
    },
    mobileNameRow: {
      width: '100%',
      boxSizing: 'border-box',
      padding: '14px 16px',
      borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.primary,
      textAlign: 'left',
      transition: 'background-color 0.15s ease',
      WebkitTapHighlightColor: 'transparent',
    },
    rolesTabWrap: {
      maxWidth: '100%',
      overflowX: 'auto',
      WebkitOverflowScrolling: 'touch',
    },
  };

  if (!canViewEmployees && !permissionsLoading) {
    return (
      <SessionManager>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#f9fafb'
        }}>
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ color: '#374151', marginBottom: '16px' }}>Access Denied</h2>
            <p style={{ color: '#6b7280' }}>You do not have permission to view employees</p>
          </div>
        </div>
      </SessionManager>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'admin']}
      requireBusiness={true}
      componentName="EmployeeScreen"
    >
      <SecurityWrapper>
        <SessionManager>
          <div style={styles.container}>
            <TavariModuleHeader
              title="Employee Management"
              description="Employee directory and role access. For position order, shift premiums, and related settings, use Tavari HR → Employee Management → Position Management."
              actionLabel={canAddEmployees ? 'Add Employee' : undefined}
              onAction={handleAddEmployee}
              containerStyle={
                isNarrowViewport
                  ? {
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      gap: '14px',
                    }
                  : undefined
              }
              contentStyle={isNarrowViewport ? { width: '100%', minWidth: 0 } : undefined}
              actionContainerStyle={
                isNarrowViewport
                  ? {
                      minWidth: 0,
                      width: '100%',
                      maxWidth: '100%',
                      alignSelf: 'stretch',
                      display: 'block',
                    }
                  : undefined
              }
              actionButtonStyle={
                isNarrowViewport
                  ? {
                      width: '100%',
                      minHeight: '48px',
                      whiteSpace: 'normal',
                      padding: '12px 16px',
                    }
                  : undefined
              }
              descriptionStyle={
                isNarrowViewport
                  ? { fontSize: '28px', maxWidth: 'none', lineHeight: 1.4 }
                  : undefined
              }
            />

            {/* Tab Navigation */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                gap: '2px',
                marginBottom: '20px',
                backgroundColor: '#e5e7eb',
                borderRadius: '8px',
                padding: '4px',
              }}
            >
              <button
                type="button"
                onClick={() => setActiveTab('directory')}
                style={{
                  flex: 1,
                  padding: isNarrowViewport ? '10px 12px' : '12px 20px',
                  backgroundColor: activeTab === 'directory' ? 'white' : 'transparent',
                  color: activeTab === 'directory' ? '#008080' : '#6b7280',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: isNarrowViewport ? '13px' : '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: activeTab === 'directory' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                  textAlign: 'center',
                }}
              >
                👥 Employee Directory
              </button>
              {canManageRoles && (
                <button
                  type="button"
                  onClick={() => setActiveTab('roles')}
                  style={{
                    flex: 1,
                    padding: isNarrowViewport ? '10px 12px' : '12px 20px',
                    backgroundColor: activeTab === 'roles' ? 'white' : 'transparent',
                    color: activeTab === 'roles' ? '#008080' : '#6b7280',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: isNarrowViewport ? '13px' : '14px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: activeTab === 'roles' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                    textAlign: 'center',
                  }}
                >
                  🔑 Roles & Access
                </button>
              )}
            </div>

            {/* Error Message */}
            {error && activeTab === 'directory' && (
              <div style={styles.errorBanner}>
                {error}
              </div>
            )}

            {/* Tab Content */}
            {activeTab === 'roles' ? (
              <div style={isNarrowViewport ? styles.rolesTabWrap : undefined}>
                <RoleManagementTab
                  businessId={selectedBusinessId}
                  styles={{
                    section: {
                      backgroundColor: 'white',
                      borderRadius: '8px',
                      padding: isNarrowViewport ? '16px' : '25px',
                      marginBottom: '20px',
                      border: '1px solid #e5e7eb',
                      boxSizing: 'border-box',
                      minWidth: isNarrowViewport ? 'min(100%, 520px)' : undefined,
                    },
                    sectionTitle: {
                      margin: '0 0 20px 0',
                      fontSize: isNarrowViewport ? '16px' : '18px',
                      fontWeight: 'bold',
                      color: '#1f2937',
                      borderBottom: '2px solid #008080',
                      paddingBottom: '8px',
                    },
                  }}
                />
              </div>
            ) : (
              <>
                {/* Search and Add Controls */}
                <div style={styles.headerRow}>
              <input
                type="text"
                placeholder={
                  isNarrowViewport
                    ? 'Search name, email, position…'
                    : 'Search employees by name, email, position, department, or employee #...'
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={styles.searchInput}
              />
            </div>

            {/* Employee grid (desktop) / cards (mobile) */}
            <div style={styles.gridContainer}>
              {!isNarrowViewport && (
              <div style={styles.gridHeader}>
                <span>Name</span>
                <span>Email</span>
                <span>Position</span>
                <span>Department</span>
                <span>Status</span>
                <span>Employee #</span>
                {canViewWages ? <span>Wage</span> : <span>-</span>}
                {(canFixAuth || canEditEmployees) && <span>Actions</span>}
              </div>
              )}

              {loading ? (
                <div style={styles.loading}>Loading employees...</div>
              ) : filteredEmployees.length === 0 ? (
                <div
                  style={{
                    ...styles.emptyState,
                    ...(isNarrowViewport ? { padding: '36px 16px' } : {}),
                  }}
                >
                  <h3 style={styles.emptyTitle}>
                    {search ? 'No employees found' : 'No employees yet'}
                  </h3>
                  <p style={styles.emptyText}>
                    {search 
                      ? 'Try adjusting your search terms.'
                      : 'Get started by adding your first employee.'
                    }
                  </p>
                  {!search && canAddEmployees && (
                    <button
                      type="button"
                      style={{
                        ...styles.addButton,
                        ...(isNarrowViewport ? { width: '100%', maxWidth: '100%', boxSizing: 'border-box' } : {}),
                      }}
                      onClick={handleAddEmployee}
                    >
                      Add First Employee
                    </button>
                  )}
                </div>
              ) : isNarrowViewport ? (
                <div style={styles.mobileNameList}>
                  {filteredEmployees.map((emp) => (
                    <div
                      key={emp.id}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleEmployeeClick(emp);
                        }
                      }}
                      style={{
                        ...styles.mobileNameRow,
                        ...(emp.termination_date
                          ? { color: TavariStyles.colors.gray500, textDecoration: 'line-through' }
                          : {}),
                      }}
                      aria-label={`Open profile for ${emp.full_name || 'employee'}`}
                      onClick={() => handleEmployeeClick(emp)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = TavariStyles.colors.gray50;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      {emp.full_name || 'Unknown'}
                    </div>
                  ))}
                </div>
              ) : (
                filteredEmployees.map((emp) => (
                  <div
                    key={emp.id}
                    style={styles.gridRow}
                    onClick={() => handleEmployeeClick(emp)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = TavariStyles.colors.gray50;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <span style={styles.link}>
                      {emp.full_name}
                      {emp.termination_date && (
                        <div style={{
                          fontSize: TavariStyles.typography.fontSize.xs,
                          color: TavariStyles.colors.danger,
                          fontWeight: 'normal'
                        }}>
                          Terminated: {new Date(emp.termination_date).toLocaleDateString()}
                        </div>
                      )}
                      {emp.tenure && !emp.termination_date && (
                        <div style={{
                          fontSize: TavariStyles.typography.fontSize.xs,
                          color: TavariStyles.colors.gray500,
                          fontWeight: 'normal'
                        }}>
                          {emp.tenure}
                        </div>
                      )}
                    </span>
                    
                    <span>{emp.email}</span>
                    
                    <span><PositionLabel businessId={selectedBusinessId} value={emp.position} emptyFallback="-" /></span>
                    
                    <span>{emp.department || '-'}</span>
                    
                    <span>
                      <div
                        style={{
                          ...styles.statusBadge,
                          backgroundColor: `${getStatusColor(emp.employment_status)}20`,
                          color: getStatusColor(emp.employment_status),
                          border: `1px solid ${getStatusColor(emp.employment_status)}40`
                        }}
                      >
                        {emp.employment_status?.replace('_', ' ') || 'Active'}
                      </div>
                    </span>
                    
                    <span>
                      {emp.employee_number ? (
                        <span style={styles.employeeNumber}>
                          #{emp.employee_number}
                        </span>
                      ) : (
                        <span style={{color: TavariStyles.colors.gray400}}>-</span>
                      )}
                    </span>
                    
                    {canViewWages ? (
                      <span style={styles.wage}>
                        {emp.wage ? `$${formatTaxAmount(emp.wage)}/hr` : '-'}
                      </span>
                    ) : (
                      <span style={{color: TavariStyles.colors.gray400}}>***</span>
                    )}
                    
                    {(canFixAuth || canEditEmployees) && (
                      <span style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {canEditEmployees && (
                          <button
                            type="button"
                            style={{
                              ...styles.fixAuthButton,
                              backgroundColor: TavariStyles.colors.primary,
                              fontSize: '14px'
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewContract(emp);
                            }}
                            onMouseOver={(e) => {
                              e.target.style.backgroundColor = '#006666';
                            }}
                            onMouseOut={(e) => {
                              e.target.style.backgroundColor = TavariStyles.colors.primary;
                            }}
                            title="View employee contract"
                          >
                            📄 Contract
                          </button>
                        )}
                        {canFixAuth && (
                          <button
                            type="button"
                            style={styles.fixAuthButton}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleFixAuth(emp);
                            }}
                            onMouseOver={(e) => {
                              e.target.style.backgroundColor = '#f57c00';
                            }}
                            onMouseOut={(e) => {
                              e.target.style.backgroundColor = '#ff9800';
                            }}
                            title="Fix authentication for this employee"
                          >
                            🔧 Fix Auth
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
              </>
            )}
          </div>

          {/* Add Employee Modal */}
          {canAddEmployees && (
            <AddEmployeeModal
              isOpen={showAddModal}
              onClose={() => setShowAddModal(false)}
              businessId={selectedBusinessId}
              onEmployeeCreated={handleEmployeeCreated}
            />
          )}

          {/* Fix Employee Auth Modal */}
          {canFixAuth && (
            <FixEmployeeAuthModal
              isOpen={showFixAuthModal}
              onClose={() => {
                setShowFixAuthModal(false);
                setSelectedEmployeeForFix(null);
              }}
              employee={selectedEmployeeForFix}
              onSuccess={handleFixAuthSuccess}
            />
          )}
        </SessionManager>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default EmployeeScreen;