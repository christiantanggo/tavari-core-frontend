// screens/HR/WriteupManagement.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useNavigate } from 'react-router-dom';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';

const WriteupManagement = () => {
  const navigate = useNavigate();

  // Security context
  const {
    recordAction,
    logSecurityEvent,
    checkRateLimit
  } = useSecurityContext({
    componentName: 'WriteupManagement',
    sensitiveComponent: true, // Writeups are sensitive HR data
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication
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
    requiredRoles: ['owner', 'manager', 'admin', 'hr_admin'],
    requireBusiness: true,
    componentName: 'WriteupManagement'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Component state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [writeups, setWriteups] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [dataLoading, setDataLoading] = useState(false);

  // Permission checks
  const canViewWriteups = hasAnyPermission([
    'hr.writeups.view',
    'hr.writeups.view_all'
  ]) || hasElevatedPrivileges();

  const canCreateWriteups = hasPermission('hr.writeups.create') || hasElevatedPrivileges();
  const canEditWriteups = hasPermission('hr.writeups.edit') || isOwner;
  const canDeleteWriteups = hasPermission('hr.writeups.delete') || isOwner;

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewWriteups) {
      toast.error('You do not have permission to access Writeup Management');
      navigate('/dashboard/hr/dashboard');
    }
  }, [permissionsLoading, canViewWriteups]);

  useEffect(() => {
    if (selectedBusinessId && authUser && !authLoading && !permissionsLoading && canViewWriteups) {
      checkUserAndBusiness();
    }
  }, [selectedBusinessId, authUser, authLoading, permissionsLoading, canViewWriteups]);

  const checkUserAndBusiness = async () => {
    try {
      await logSecurityEvent('writeup_management_access', {
        action: 'access_writeup_management',
        business_id: selectedBusinessId,
        sensitive_data: true
      }, 'medium');

      // Load employees and writeups data
      await loadEmployees(selectedBusinessId);
      await loadWriteups(selectedBusinessId);

      recordAction('view_writeup_management', selectedBusinessId);
      
    } catch (error) {
      console.error('Error loading writeup management:', error);
      setError('An unexpected error occurred. Please try again.');
      toast.error('Failed to load writeup management');

      await logSecurityEvent('writeup_management_load_failed', {
        error_message: error.message,
        business_id: selectedBusinessId
      }, 'high');
    } finally {
      setLoading(false);
    }
  };

  const loadEmployees = async (businessId) => {
    try {
      await logSecurityEvent('load_employees_for_writeups', {
        action: 'load_employee_list',
        business_id: businessId
      }, 'low');

      // Load employees from enhanced users table
      const { data: employees, error } = await supabase
        .from('users')
        .select(`
          id,
          first_name,
          last_name,
          employee_number,
          department,
          position,
          employment_status,
          status,
          business_users!inner(business_id)
        `)
        .eq('business_users.business_id', businessId);

      if (error) {
        console.error('Error loading employees:', error);
        toast.error('Failed to load employee list');
        return;
      }

      // Filter to active employees only
      const activeEmployees = (employees || []).filter(emp => {
        const status = emp.employment_status || emp.status || 'active';
        return status === 'active';
      });

      setEmployees(activeEmployees);
      recordAction('employees_loaded', { count: activeEmployees.length });

    } catch (error) {
      console.error('Error loading employees:', error);
      setError('Failed to load employee list');
      toast.error('Failed to load employee list');
    }
  };

  const loadWriteups = async (businessId) => {
    if (!canViewWriteups) return;

    try {
      setDataLoading(true);
      
      await logSecurityEvent('load_writeups', {
        action: 'load_writeup_data',
        business_id: businessId,
        sensitive_data: true
      }, 'medium');

      console.log('Loading writeups for business:', businessId);
      
      // Placeholder - will be replaced with actual writeup storage solution
      // TODO: Implement actual writeup loading when table structure is finalized
      setWriteups([]);

      recordAction('writeups_loaded', { 
        business_id: businessId,
        count: 0 
      });
      
    } catch (error) {
      console.error('Error loading writeups:', error);
      setError('Failed to load writeup data');
      toast.error('Failed to load writeup data');

      await logSecurityEvent('load_writeups_failed', {
        error_message: error.message,
        business_id: businessId
      }, 'high');
    } finally {
      setDataLoading(false);
    }
  };

  const handleCreateWriteup = async () => {
    if (!canCreateWriteups) {
      toast.error('You do not have permission to create writeups');
      return;
    }

    // Rate limiting check
    const canProceed = await checkRateLimit('create_writeup', 5, 60);
    if (!canProceed) {
      toast.error('Too many writeup creation requests. Please wait a moment.');
      return;
    }

    await logSecurityEvent('create_writeup_initiated', {
      action: 'open_create_writeup',
      business_id: selectedBusinessId,
      sensitive_data: true
    }, 'medium');

    recordAction('create_writeup_opened', selectedBusinessId);
    toast.info('Writeup creation feature coming soon');
  };

  const handleFilterEmployee = (employeeId) => {
    setSelectedEmployee(employeeId);
    recordAction('filter_writeups_by_employee', { 
      employee_id: employeeId,
      filter_applied: !!employeeId 
    });
  };

  const handleBackToDashboard = () => {
    navigate('/dashboard/hr/dashboard');
  };

  // Loading and error states
  if (permissionsLoading || authLoading || loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        paddingTop: '60px',
        paddingLeft: '20px',
        paddingRight: '20px',
        paddingBottom: '20px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '32px',
            height: '32px',
            border: '3px solid #14B8A6',
            borderTop: '3px solid transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 8px auto'
          }}></div>
          <p style={{ 
            margin: 0, 
            color: '#6b7280',
            fontSize: '16px',
            fontWeight: '500'
          }}>
            Loading Writeup Management...
          </p>
        </div>
      </div>
    );
  }

  if (!canViewWriteups) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        paddingTop: '60px',
        paddingLeft: '20px',
        paddingRight: '20px',
        paddingBottom: '20px'
      }}>
        <div style={{ 
          textAlign: 'center',
          maxWidth: '400px'
        }}>
          <h2 style={{ 
            fontSize: '24px', 
            fontWeight: '600', 
            color: '#111827', 
            margin: '0 0 8px 0'
          }}>
            Access Denied
          </h2>
          <p style={{ 
            color: '#6b7280', 
            marginBottom: '20px',
            fontSize: '16px',
            lineHeight: '1.5',
            margin: '0 0 20px 0'
          }}>
            You do not have permission to access Writeup Management.
          </p>
          <button 
            onClick={handleBackToDashboard}
            style={{
              padding: '12px 24px',
              backgroundColor: '#14B8A6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease',
              outline: 'none'
            }}
            onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
            onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
          >
            Return to HR Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (authError || error) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        paddingTop: '60px',
        paddingLeft: '20px',
        paddingRight: '20px',
        paddingBottom: '20px'
      }}>
        <div style={{ 
          textAlign: 'center',
          maxWidth: '400px'
        }}>
          <h2 style={{ 
            fontSize: '24px', 
            fontWeight: '600', 
            color: '#111827', 
            margin: '0 0 8px 0'
          }}>
            Access Denied
          </h2>
          <p style={{ 
            color: '#6b7280', 
            marginBottom: '20px',
            fontSize: '16px',
            lineHeight: '1.5',
            margin: '0 0 20px 0'
          }}>
            {authError || error}
          </p>
          <button 
            onClick={handleBackToDashboard}
            style={{
              padding: '12px 24px',
              backgroundColor: '#14B8A6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease',
              outline: 'none'
            }}
            onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
            onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
          >
            Return to HR Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'admin', 'hr_admin']}
      requireBusiness={true}
      componentName="WriteupManagement"
    >
      <SecurityWrapper>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          paddingTop: '60px',
          paddingLeft: '20px',
          paddingRight: '20px',
          paddingBottom: '20px'
        }}>
          <style>
            {`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}
          </style>

          {/* Header */}
          <div style={{ marginBottom: '30px' }}>
            <h1 style={{ 
              fontSize: '32px', 
              fontWeight: 'bold', 
              color: '#111827',
              margin: '0 0 8px 0'
            }}>
              Writeup Management
            </h1>
            <p style={{ 
              color: '#6b7280', 
              fontSize: '16px',
              margin: 0
            }}>
              Manage disciplinary actions and employee writeups • {businessData?.business_name || businessData?.name || 'Business'}
            </p>
          </div>

          {/* Security Notice for Sensitive Data */}
          <div style={{
            backgroundColor: '#fef3c7',
            border: '1px solid #fbbf24',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <span style={{ fontSize: '20px' }}>🔒</span>
            <p style={{ 
              margin: 0, 
              fontSize: '14px', 
              color: '#92400e' 
            }}>
              <strong>Sensitive HR Data:</strong> All writeup actions are logged for compliance and security purposes.
            </p>
          </div>

          {/* Controls */}
          <div style={{
            backgroundColor: 'white',
            padding: '24px',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
            marginBottom: '20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px'
          }}>
            <div style={{ flex: 1, minWidth: '250px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '6px'
              }}>
                Filter by Employee
              </label>
              <select
                value={selectedEmployee}
                onChange={(e) => handleFilterEmployee(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '2px solid #14B8A6',
                  borderRadius: '8px',
                  fontSize: '16px',
                  outline: 'none'
                }}
              >
                <option value="">All Employees</option>
                {employees.map(employee => (
                  <option key={employee.id} value={employee.id}>
                    {employee.last_name}, {employee.first_name} 
                    {employee.employee_number && ` (#${employee.employee_number})`}
                  </option>
                ))}
              </select>
            </div>
            
            <PermissionGate 
              permissions={['hr.writeups.create']} 
              requireElevated
              fallback={
                <button
                  disabled
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#9CA3AF',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'not-allowed',
                    opacity: 0.6,
                    outline: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  title="You do not have permission to create writeups"
                >
                  + New Writeup
                </button>
              }
            >
              <button
                onClick={handleCreateWriteup}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#14B8A6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s ease',
                  outline: 'none',
                  whiteSpace: 'nowrap'
                }}
                onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
                onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
              >
                + New Writeup
              </button>
            </PermissionGate>
          </div>

          {/* Stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '20px',
            marginBottom: '40px'
          }}>
            <div style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
            }}>
              <h3 style={{ 
                fontSize: '18px', 
                fontWeight: '600', 
                color: '#111827', 
                margin: '0 0 8px 0'
              }}>
                Total Writeups
              </h3>
              <p style={{ 
                fontSize: '28px', 
                fontWeight: 'bold', 
                color: '#14B8A6',
                margin: 0
              }}>
                {writeups.length}
              </p>
            </div>
            
            <div style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
            }}>
              <h3 style={{ 
                fontSize: '18px', 
                fontWeight: '600', 
                color: '#111827', 
                margin: '0 0 8px 0'
              }}>
                Pending Acknowledgment
              </h3>
              <p style={{ 
                fontSize: '28px', 
                fontWeight: 'bold', 
                color: '#f59e0b',
                margin: 0
              }}>
                {writeups.filter(w => !w.employee_acknowledged).length}
              </p>
            </div>
            
            <div style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
            }}>
              <h3 style={{ 
                fontSize: '18px', 
                fontWeight: '600', 
                color: '#111827', 
                margin: '0 0 8px 0'
              }}>
                Last 30 Days
              </h3>
              <p style={{ 
                fontSize: '28px', 
                fontWeight: 'bold', 
                color: '#3b82f6',
                margin: 0
              }}>
                {writeups.filter(w => w.created_at >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).length}
              </p>
            </div>
          </div>

          {/* Content */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
            overflow: 'hidden'
          }}>
            {dataLoading ? (
              <div style={{ 
                padding: '60px 20px', 
                textAlign: 'center' 
              }}>
                <div style={{
                  width: '24px',
                  height: '24px',
                  border: '3px solid #14B8A6',
                  borderTop: '3px solid transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  margin: '0 auto 8px auto'
                }}></div>
                <p style={{ margin: 0, color: '#6b7280' }}>Loading writeups...</p>
              </div>
            ) : writeups.length === 0 ? (
              <div style={{ 
                padding: '60px 20px', 
                textAlign: 'center', 
                color: '#6b7280' 
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>📝</div>
                <h3 style={{ 
                  fontSize: '20px', 
                  fontWeight: '600', 
                  color: '#111827', 
                  margin: '0 0 8px 0' 
                }}>
                  No Writeups Found
                </h3>
                <p style={{ 
                  fontSize: '16px', 
                  margin: '0 0 24px 0' 
                }}>
                  {selectedEmployee ? 'No writeups for selected employee' : 'No writeups have been created yet'}
                </p>
                {!selectedEmployee && canCreateWriteups && (
                  <button
                    onClick={handleCreateWriteup}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: '#14B8A6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      outline: 'none'
                    }}
                    onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
                    onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
                  >
                    Create First Writeup
                  </button>
                )}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                {/* Writeups table will go here when writeup storage is implemented */}
                <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
                  <p style={{ marginBottom: '10px' }}>
                    Writeup table will be implemented once writeup storage structure is determined
                  </p>
                  <p style={{ fontSize: '14px', color: '#9ca3af' }}>
                    Writeup data is highly sensitive and requires proper security measures
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default WriteupManagement;