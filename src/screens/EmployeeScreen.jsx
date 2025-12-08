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
import { TavariStyles } from '../utils/TavariStyles';
import toast from 'react-hot-toast';

// Modals
import AddEmployeeModal from '../components/HR/AddEmployeeModal';
import FixEmployeeAuthModal from '../components/HR/FixEmployeeAuthModal';

import SessionManager from '../components/SessionManager';
import PositionsTab from '../components/HR/PositionsTab';
import RoleManagementTab from '../components/Settings/RoleManagementTab';
import HierarchyChartTab from '../components/HR/HierarchyChartTab';

const EmployeeScreen = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('directory'); // 'directory', 'positions', 'roles', or 'hierarchy'

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showFixAuthModal, setShowFixAuthModal] = useState(false);
  const [selectedEmployeeForFix, setSelectedEmployeeForFix] = useState(null);

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
      
      await recordAction('employee_list_view', selectedBusinessId, true);
      
      await logSecurityEvent('employee_data_access', {
        action: 'load_employee_list',
        business_id: selectedBusinessId,
        viewer_role: userRole
      }, 'low');
      
      const { data: userData, error: userError } = await supabase
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

      if (userError) throw userError;

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
          role: user.business_users?.role || 'employee',
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

    const rateLimitOk = await checkRateLimit('employee_view', 30, 60000);
    if (!rateLimitOk) {
      toast.error('Too many requests. Please wait a moment.');
      return;
    }

    await recordAction('view_employee_details', employee.id, true);
    
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

    const rateLimitOk = await checkRateLimit('add_employee_modal', 10, 60000);
    if (!rateLimitOk) {
      toast.error('Too many requests. Please wait a moment.');
      return;
    }

    await recordAction('open_add_employee_modal', null, true);
    
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

    await recordAction('employee_created_success', newEmployeeId, true);
    
    toast.success('Employee created successfully');
    fetchEmployees(); // Reload the list
  };
  
  const handleFixAuth = async (employee) => {
    if (!canFixAuth) {
      toast.error('You do not have permission to fix authentication');
      return;
    }

    const rateLimitOk = await checkRateLimit('fix_auth_modal', 5, 300000);
    if (!rateLimitOk) {
      toast.error('Too many requests. Please wait.');
      return;
    }

    await recordAction('fix_employee_auth', employee.id, true);
    
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
      padding: TavariStyles.spacing['3xl'],
      paddingTop: '80px',
      boxSizing: 'border-box'
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
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing['3xl'],
      alignItems: 'center'
    },
    searchInput: {
      ...TavariStyles.components.form?.input,
      flex: 3,
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
      overflow: 'hidden',
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
    }
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
            {/* Header */}
            <div style={{ ...styles.header, marginBottom: '12px' }}>
              <h1 style={{ ...styles.title, fontSize: '28px', marginBottom: '4px' }}>Employee Management</h1>
              <p style={{ ...styles.subtitle, fontSize: '14px' }}>Manage employees and positions</p>
            </div>

            {/* Tab Navigation */}
            <div style={{
              display: 'flex',
              gap: '2px',
              marginBottom: '20px',
              backgroundColor: '#e5e7eb',
              borderRadius: '8px',
              padding: '4px'
            }}>
              <button
                onClick={() => setActiveTab('directory')}
                style={{
                  flex: 1,
                  padding: '12px 20px',
                  backgroundColor: activeTab === 'directory' ? 'white' : 'transparent',
                  color: activeTab === 'directory' ? '#008080' : '#6b7280',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: activeTab === 'directory' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                👥 Employee Directory
              </button>
              <button
                onClick={() => setActiveTab('positions')}
                style={{
                  flex: 1,
                  padding: '12px 20px',
                  backgroundColor: activeTab === 'positions' ? 'white' : 'transparent',
                  color: activeTab === 'positions' ? '#008080' : '#6b7280',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: activeTab === 'positions' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                💼 Positions
              </button>
              {canManageRoles && (
                <button
                  onClick={() => setActiveTab('roles')}
                  style={{
                    flex: 1,
                    padding: '12px 20px',
                    backgroundColor: activeTab === 'roles' ? 'white' : 'transparent',
                    color: activeTab === 'roles' ? '#008080' : '#6b7280',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: activeTab === 'roles' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  🔑 Roles & Access
                </button>
              )}
              <button
                onClick={() => setActiveTab('hierarchy')}
                style={{
                  flex: 1,
                  padding: '12px 20px',
                  backgroundColor: activeTab === 'hierarchy' ? 'white' : 'transparent',
                  color: activeTab === 'hierarchy' ? '#008080' : '#6b7280',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: activeTab === 'hierarchy' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                📊 Hierarchy Chart
              </button>
            </div>

            {/* Error Message */}
            {error && activeTab === 'directory' && (
              <div style={styles.errorBanner}>
                {error}
              </div>
            )}

            {/* Tab Content */}
            {activeTab === 'positions' ? (
              <PositionsTab businessId={selectedBusinessId} />
            ) : activeTab === 'roles' ? (
              <RoleManagementTab 
                businessId={selectedBusinessId}
                styles={{
                  section: {
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    padding: '25px',
                    marginBottom: '20px',
                    border: '1px solid #e5e7eb'
                  },
                  sectionTitle: {
                    margin: '0 0 20px 0',
                    fontSize: '18px',
                    fontWeight: 'bold',
                    color: '#1f2937',
                    borderBottom: '2px solid #008080',
                    paddingBottom: '8px'
                  }
                }}
              />
            ) : activeTab === 'hierarchy' ? (
              <HierarchyChartTab businessId={selectedBusinessId} />
            ) : (
              <>
                {/* Search and Add Controls */}
                <div style={styles.headerRow}>
              <input
                type="text"
                placeholder="Search employees by name, email, position, department, or employee #..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={styles.searchInput}
              />
              <PermissionGate permission="hr.employees.add" fallback={null}>
                <button style={styles.addButton} onClick={handleAddEmployee}>
                  <span>+</span>
                  Add Employee
                </button>
              </PermissionGate>
            </div>

            {/* Employee Grid */}
            <div style={styles.gridContainer}>
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

              {loading ? (
                <div style={styles.loading}>Loading employees...</div>
              ) : filteredEmployees.length === 0 ? (
                <div style={styles.emptyState}>
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
                    <button style={styles.addButton} onClick={handleAddEmployee}>
                      Add First Employee
                    </button>
                  )}
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
                    
                    <span>{emp.position || '-'}</span>
                    
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
                            style={{
                              ...styles.fixAuthButton,
                              backgroundColor: TavariStyles.colors.primary,
                              fontSize: '11px'
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