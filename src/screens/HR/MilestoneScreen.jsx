// src/screens/HR/MilestoneScreen.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';

const MilestoneScreen = () => {
  const navigate = useNavigate();
  
  // Security context
  const {
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'MilestoneScreen',
    sensitiveComponent: false,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'low'
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
    requiredRoles: ['owner', 'manager', 'admin', 'hr_admin'],
    requireBusiness: true,
    componentName: 'MilestoneScreen'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Component state
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  // Permission checks
  const canViewMilestones = hasAnyPermission([
    'hr.onboarding.view',
    'hr.milestones.view'
  ]) || hasElevatedPrivileges();

  const canViewCelebrations = hasPermission('hr.celebrations.view') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewMilestones) {
      toast.error('You do not have permission to view milestone tracking');
      navigate('/dashboard/hr/dashboard');
    }
  }, [permissionsLoading, canViewMilestones]);

  useEffect(() => {
    if (selectedBusinessId && !authLoading && !permissionsLoading && canViewMilestones) {
      fetchEmployeesWithOnboarding();
    }
  }, [selectedBusinessId, authLoading, permissionsLoading, canViewMilestones]);

  const fetchEmployeesWithOnboarding = async () => {
    if (!selectedBusinessId || !canViewMilestones) return;
    
    try {
      setLoading(true);

      await logSecurityEvent('milestone_tracking_access', {
        action: 'load_employees_with_onboarding',
        business_id: selectedBusinessId
      }, 'low');

      const { data, error } = await supabase
        .rpc('get_employees_with_onboarding_assignments', {
          p_business_id: selectedBusinessId
        });

      if (error) {
        console.error('Error fetching employees:', error);
        setEmployees([]);
        toast.error('Failed to load employees');
        
        await logSecurityEvent('milestone_tracking_load_failed', {
          error_message: error.message,
          business_id: selectedBusinessId
        }, 'medium');
      } else {
        setEmployees(data || []);
        recordAction('view_milestone_tracking', selectedBusinessId);
      }
    } catch (error) {
      console.error('Error in fetchEmployeesWithOnboarding:', error);
      setEmployees([]);
      toast.error('An error occurred while loading employees');

      await logSecurityEvent('milestone_tracking_error', {
        error_message: error.message,
        business_id: selectedBusinessId
      }, 'medium');
    } finally {
      setLoading(false);
    }
  };

  const handleViewCelebrations = () => {
    if (!canViewCelebrations) {
      toast.error('You do not have permission to view celebrations');
      return;
    }

    recordAction('navigate_to_celebrations', selectedBusinessId);
    // Navigate to celebrations page when implemented
    toast.info('Celebrations feature coming soon!');
  };

  const handleEmployeeClick = (employee) => {
    recordAction('view_employee_milestones', {
      employee_id: employee.user_id,
      employee_name: employee.full_name
    });
    // Navigate to employee milestone detail when implemented
    toast.info(`Viewing milestones for ${employee.full_name}`);
  };

  // Loading states
  if (permissionsLoading || authLoading) {
    return (
      <div style={{...styles.container, justifyContent: 'center', alignItems: 'center'}}>
        <h3>Loading Milestone Tracking...</h3>
        <p>Authenticating user and loading business data...</p>
      </div>
    );
  }

  if (!canViewMilestones) {
    return (
      <div style={{...styles.container, justifyContent: 'center', alignItems: 'center'}}>
        <h3>Access Denied</h3>
        <p>You do not have permission to view milestone tracking</p>
        <button 
          style={styles.createButton}
          onClick={() => navigate('/dashboard/hr/dashboard')}
        >
          Return to HR Dashboard
        </button>
      </div>
    );
  }

  if (authError) {
    return (
      <div style={{...styles.container, justifyContent: 'center', alignItems: 'center'}}>
        <h3>Authentication Error</h3>
        <p>{authError}</p>
        <button 
          style={styles.createButton}
          onClick={() => navigate('/login')}
        >
          Return to Login
        </button>
      </div>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'admin', 'hr_admin']}
      requireBusiness={true}
      componentName="MilestoneScreen"
    >
      <SecurityWrapper>
        <div style={styles.container}>
          {/* Header Section */}
          <div style={{ marginBottom: '30px', textAlign: 'center' }}>
            <h1 style={{ 
              fontSize: '28px', 
              fontWeight: 'bold', 
              color: '#374151', 
              margin: '0 0 10px 0' 
            }}>
              Onboarding Milestone Tracking
            </h1>
            <p style={{ 
              fontSize: '16px', 
              color: '#6B7280', 
              margin: '0' 
            }}>
              Track employee onboarding progress and celebrate achievements
            </p>
          </div>

          {/* Primary Actions - Full Width Buttons */}
          <div style={{ marginBottom: '30px' }}>
            <PermissionGate 
              permissions={['hr.celebrations.view']} 
              fallback={
                <button
                  disabled
                  style={{
                    width: '100%',
                    padding: '16px 24px',
                    backgroundColor: '#9CA3AF',
                    color: 'white',
                    fontWeight: 'bold',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    cursor: 'not-allowed',
                    marginBottom: '15px',
                    opacity: 0.6
                  }}
                >
                  🎉 View Recent Celebrations (No Permission)
                </button>
              }
            >
              <button
                onClick={handleViewCelebrations}
                style={{
                  width: '100%',
                  padding: '16px 24px',
                  backgroundColor: '#14B8A6',
                  color: 'white',
                  fontWeight: 'bold',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  cursor: 'pointer',
                  marginBottom: '15px',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = '#0F9D8F';
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 4px 12px rgba(20, 184, 166, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = '#14B8A6';
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = 'none';
                }}
              >
                🎉 View Recent Celebrations
              </button>
            </PermissionGate>
          </div>

          {/* Employee Cards - 3x Grid Layout */}
          {loading ? (
            <div style={{ 
              textAlign: 'center', 
              padding: '40px', 
              color: '#6B7280' 
            }}>
              <div style={{
                fontSize: '18px',
                fontWeight: 'bold',
                marginBottom: '10px'
              }}>
                Loading employees...
              </div>
            </div>
          ) : employees.length === 0 ? (
            <div style={{ 
              textAlign: 'center', 
              padding: '40px', 
              color: '#6B7280' 
            }}>
              <div style={{
                fontSize: '18px',
                fontWeight: 'bold',
                marginBottom: '10px'
              }}>
                No employees with onboarding assignments found
              </div>
              <p>Assign onboarding tasks to employees to track their progress here.</p>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: '20px' }}>
                <h2 style={{ 
                  fontSize: '20px', 
                  fontWeight: 'bold', 
                  color: '#374151',
                  margin: '0'
                }}>
                  Employees in Onboarding ({employees.length})
                </h2>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '20px',
                marginBottom: '20px'
              }}>
                {employees.map((employee) => (
                  <button
                    key={employee.user_id}
                    onClick={() => handleEmployeeClick(employee)}
                    style={{
                      backgroundColor: 'white',
                      border: '2px solid #14B8A6',
                      borderRadius: '8px',
                      padding: '20px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      textAlign: 'center',
                      aspectRatio: '1',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#F0FDFA';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(20, 184, 166, 0.2)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'white';
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <div style={{
                      fontSize: '16px',
                      fontWeight: 'bold',
                      color: '#374151',
                      marginBottom: '8px'
                    }}>
                      {employee.full_name}
                    </div>
                    <div style={{
                      fontSize: '14px',
                      color: '#6B7280',
                      marginBottom: '12px'
                    }}>
                      {employee.total_tasks} tasks • {employee.completion_percentage}% complete
                    </div>
                    <div style={{
                      width: '100%',
                      height: '6px',
                      backgroundColor: '#E5E7EB',
                      borderRadius: '3px',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        width: `${employee.completion_percentage}%`,
                        height: '100%',
                        backgroundColor: '#14B8A6',
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Summary Stats */}
          <div style={{
            marginTop: '30px',
            padding: '20px',
            backgroundColor: 'white',
            borderRadius: '8px',
            border: '1px solid #E5E7EB'
          }}>
            <h3 style={{ 
              fontSize: '18px', 
              fontWeight: 'bold', 
              color: '#374151',
              marginBottom: '15px'
            }}>
              Milestone Summary
            </h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '20px'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#14B8A6' }}>
                  {employees.length}
                </div>
                <div style={{ fontSize: '14px', color: '#6B7280' }}>
                  Total Employees
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#14B8A6' }}>
                  {employees.reduce((sum, emp) => sum + (emp.total_tasks || 0), 0)}
                </div>
                <div style={{ fontSize: '14px', color: '#6B7280' }}>
                  Total Tasks
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#14B8A6' }}>
                  {employees.length > 0 ? Math.round(employees.reduce((sum, emp) => sum + (emp.completion_percentage || 0), 0) / employees.length) : 0}%
                </div>
                <div style={{ fontSize: '14px', color: '#6B7280' }}>
                  Average Progress
                </div>
              </div>
            </div>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

// Styles matching TabScreen pattern
const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: '#f8f9fa',
    padding: '20px',
    paddingTop: '100px',
    boxSizing: 'border-box'
  },
  createButton: {
    padding: '12px 20px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  }
};

export default MilestoneScreen;