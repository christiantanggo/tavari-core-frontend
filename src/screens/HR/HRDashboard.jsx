// screens/HR/HRDashboard.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import toast from 'react-hot-toast';

const HRDashboard = () => {
  const navigate = useNavigate();

  // Security context
  const {
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'HRDashboard',
    sensitiveComponent: false,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'low'
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
    componentName: 'HRDashboard'
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
  const [dashboardStats, setDashboardStats] = useState(null);
  const [error, setError] = useState(null);

  // Permission checks
  const canViewHRDashboard = hasAnyPermission([
    'hr.dashboard.view',
    'hr.employees.view'
  ]) || hasElevatedPrivileges();

  const canAccessEmployees = hasAnyPermission(['hr.employees.view', 'hr.employees.view_all']) || hasElevatedPrivileges();
  const canAccessOnboarding = hasPermission('hr.onboarding.view') || hasElevatedPrivileges();
  const canAccessContracts = hasPermission('hr.contracts.view') || hasElevatedPrivileges();
  const canAccessPolicies = hasPermission('hr.policies.view') || hasElevatedPrivileges();
  const canAccessWriteups = hasPermission('hr.writeups.view') || hasElevatedPrivileges();
  const canAccessDocuments = hasPermission('hr.documents.view') || hasElevatedPrivileges();
  const canAccessSettings = hasPermission('hr.settings.manage') || isOwner();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewHRDashboard) {
      toast.error('You do not have permission to access the HR Dashboard');
      navigate('/dashboard/home');
    }
  }, [permissionsLoading, canViewHRDashboard]);

  useEffect(() => {
    if (selectedBusinessId && !authLoading && !permissionsLoading && canViewHRDashboard) {
      loadDashboardStats();
    }
  }, [selectedBusinessId, authLoading, permissionsLoading, canViewHRDashboard]);

  const loadDashboardStats = async () => {
    try {
      setLoading(true);

      await logSecurityEvent('hr_dashboard_access', {
        action: 'view_hr_dashboard',
        business_id: selectedBusinessId
      }, 'low');

      // Calculate stats directly from users table
      const { data: employees, error } = await supabase
        .from('users')
        .select(`
          id,
          employment_status,
          status,
          hire_date,
          start_date,
          business_users!inner(business_id)
        `)
        .eq('business_users.business_id', selectedBusinessId);

      if (error) {
        console.error('Error loading employees for stats:', error);
        setDashboardStats({
          total_employees: 0,
          employees_on_probation: 0,
          pending_onboarding: 0,
          overdue_policies: 0,
          expiring_contracts: 0,
          expiring_documents: 0
        });
        return;
      }

      const now = new Date();
      const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
      const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);

      // Calculate statistics
      const totalEmployees = employees.filter(emp => {
        const status = emp.employment_status || emp.status || 'active';
        return status === 'active';
      }).length;

      const employeesOnProbation = employees.filter(emp => {
        const status = emp.employment_status || emp.status || 'active';
        const hireDate = emp.hire_date || emp.start_date;
        if (status !== 'active' || !hireDate) return false;
        const hire = new Date(hireDate);
        return hire > ninetyDaysAgo;
      }).length;

      const pendingOnboarding = employees.filter(emp => {
        const status = emp.employment_status || emp.status || 'active';
        const hireDate = emp.hire_date || emp.start_date;
        if (status !== 'active' || !hireDate) return false;
        const hire = new Date(hireDate);
        return hire > thirtyDaysAgo;
      }).length;

      setDashboardStats({
        total_employees: totalEmployees,
        employees_on_probation: employeesOnProbation,
        pending_onboarding: pendingOnboarding,
        overdue_policies: 0,
        expiring_contracts: 0,
        expiring_documents: 0
      });

      recordAction('view_dashboard_stats', selectedBusinessId);

    } catch (error) {
      console.error('Error calculating dashboard stats:', error);
      setDashboardStats({
        total_employees: 0,
        employees_on_probation: 0,
        pending_onboarding: 0,
        overdue_policies: 0,
        expiring_contracts: 0,
        expiring_documents: 0
      });

      await logSecurityEvent('dashboard_stats_load_failed', {
        error_message: error.message,
        business_id: selectedBusinessId
      }, 'medium');
    } finally {
      setLoading(false);
    }
  };

  const handleNavigation = (path) => {
    recordAction('navigate_from_dashboard', path);
    navigate(path);
  };

  const handleBackToDashboard = () => {
    navigate('/dashboard/home');
  };

  // Loading states
  if (permissionsLoading || authLoading || loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={{ textAlign: 'center' }}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>
            Loading HR Dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (!canViewHRDashboard) {
    return (
      <div style={styles.errorContainer}>
        <div style={styles.errorContent}>
          <h2 style={styles.errorTitle}>
            Access Denied
          </h2>
          <p style={styles.errorText}>
            You do not have permission to access the HR Dashboard.
          </p>
          <button 
            onClick={handleBackToDashboard}
            style={styles.backButton}
            onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
            onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (authError || error) {
    return (
      <div style={styles.errorContainer}>
        <div style={styles.errorContent}>
          <h2 style={styles.errorTitle}>
            Access Denied
          </h2>
          <p style={styles.errorText}>
            {authError || error}
          </p>
          <button 
            onClick={handleBackToDashboard}
            style={styles.backButton}
            onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
            onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'admin', 'hr_admin']}
      requireBusiness={true}
      componentName="HRDashboard"
    >
      <SecurityWrapper>
        <div style={styles.container}>
          {/* Add keyframes for spinner animation */}
          <style>
            {`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}
          </style>

          {/* Header */}
          <div style={styles.header}>
            <h1 style={styles.mainTitle}>
              HR & Compliance Dashboard
            </h1>
            <p style={styles.subtitle}>
              {businessData?.business_name || 'Business'} • {userRole}
            </p>
          </div>

          {/* Stats Grid */}
          {dashboardStats && (
            <div style={styles.statsGrid}>
              <div style={styles.statCard}>
                <h3 style={styles.statTitle}>
                  Total Employees
                </h3>
                <p style={{ ...styles.statValue, color: '#14B8A6' }}>
                  {dashboardStats.total_employees}
                </p>
              </div>
              
              <div style={styles.statCard}>
                <h3 style={styles.statTitle}>
                  On Probation
                </h3>
                <p style={{ ...styles.statValue, color: '#f59e0b' }}>
                  {dashboardStats.employees_on_probation}
                </p>
              </div>
              
              <div style={styles.statCard}>
                <h3 style={styles.statTitle}>
                  New Hires (30 days)
                </h3>
                <p style={{ ...styles.statValue, color: '#3b82f6' }}>
                  {dashboardStats.pending_onboarding}
                </p>
              </div>
              
              <div style={styles.statCard}>
                <h3 style={styles.statTitle}>
                  Policy Items
                </h3>
                <p style={{ ...styles.statValue, color: '#ef4444' }}>
                  {dashboardStats.overdue_policies}
                </p>
              </div>
              
              <div style={styles.statCard}>
                <h3 style={styles.statTitle}>
                  Contract Items
                </h3>
                <p style={{ ...styles.statValue, color: '#eab308' }}>
                  {dashboardStats.expiring_contracts}
                </p>
              </div>
              
              <div style={styles.statCard}>
                <h3 style={styles.statTitle}>
                  Document Items
                </h3>
                <p style={{ ...styles.statValue, color: '#8b5cf6' }}>
                  {dashboardStats.expiring_documents}
                </p>
              </div>
            </div>
          )}

          {/* Quick Actions - Permission Gated */}
          <div style={styles.actionsGrid}>
            <PermissionGate permissions={['hr.employees.view']} fallback={null}>
              <button 
                onClick={() => handleNavigation('/dashboard/hr/employees')}
                style={styles.actionButton}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#f0fdfa';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px 0 rgba(20, 184, 166, 0.15)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'white';
                  e.currentTarget.style.transform = 'translateY(0px)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <h4 style={styles.actionTitle}>
                  Employee Profiles
                </h4>
                <p style={styles.actionDescription}>
                  Manage employee information
                </p>
              </button>
            </PermissionGate>
            
            <PermissionGate permissions={['hr.onboarding.view']} fallback={null}>
              <button 
                onClick={() => handleNavigation('/dashboard/hr/onboarding')}
                style={styles.actionButton}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#f0fdfa';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px 0 rgba(20, 184, 166, 0.15)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'white';
                  e.currentTarget.style.transform = 'translateY(0px)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <h4 style={styles.actionTitle}>
                  Onboarding Center
                </h4>
                <p style={styles.actionDescription}>
                  Track new hire progress
                </p>
              </button>
            </PermissionGate>

            <PermissionGate permissions={['hr.onboarding.view']} fallback={null}>
              <button 
                onClick={() => handleNavigation('/dashboard/hr/milestones')}
                style={styles.actionButton}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#f0fdfa';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px 0 rgba(20, 184, 166, 0.15)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'white';
                  e.currentTarget.style.transform = 'translateY(0px)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <h4 style={styles.actionTitle}>
                  Milestone Tracking
                </h4>
                <p style={styles.actionDescription}>
                  Track onboarding milestones and celebrate achievements
                </p>
              </button>
            </PermissionGate>

            <PermissionGate permissions={['hr.onboarding.view']} fallback={null}>
              <button 
                onClick={() => handleNavigation('/dashboard/hr/orientation')}
                style={styles.actionButton}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#f0fdfa';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px 0 rgba(20, 184, 166, 0.15)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'white';
                  e.currentTarget.style.transform = 'translateY(0px)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <h4 style={styles.actionTitle}>
                  Orientation Calendar
                </h4>
                <p style={styles.actionDescription}>
                  Schedule and track orientations
                </p>
              </button>
            </PermissionGate>
            
            <PermissionGate permissions={['hr.contracts.view']} fallback={null}>
              <button 
                onClick={() => handleNavigation('/dashboard/hr/contracts')}
                style={styles.actionButton}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#f0fdfa';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px 0 rgba(20, 184, 166, 0.15)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'white';
                  e.currentTarget.style.transform = 'translateY(0px)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <h4 style={styles.actionTitle}>
                  Contracts
                </h4>
                <p style={styles.actionDescription}>
                  Manage employment contracts
                </p>
              </button>
            </PermissionGate>
            
            <PermissionGate permissions={['hr.policies.view']} fallback={null}>
              <button 
                onClick={() => handleNavigation('/dashboard/hr/policies')}
                style={styles.actionButton}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#f0fdfa';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px 0 rgba(20, 184, 166, 0.15)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'white';
                  e.currentTarget.style.transform = 'translateY(0px)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <h4 style={styles.actionTitle}>
                  Policy Center
                </h4>
                <p style={styles.actionDescription}>
                  Policies & acknowledgments
                </p>
              </button>
            </PermissionGate>

            <PermissionGate permissions={['hr.writeups.view']} fallback={null}>
              <button 
                onClick={() => handleNavigation('/dashboard/hr/writeups')}
                style={styles.actionButton}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#f0fdfa';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px 0 rgba(20, 184, 166, 0.15)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'white';
                  e.currentTarget.style.transform = 'translateY(0px)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <h4 style={styles.actionTitle}>
                  Disciplinary Actions
                </h4>
                <p style={styles.actionDescription}>
                  Manage writeups & warnings
                </p>
              </button>
            </PermissionGate>

            <PermissionGate permissions={['hr.documents.view']} fallback={null}>
              <button 
                onClick={() => handleNavigation('/dashboard/hr/document-expiry')}
                style={styles.actionButton}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#f0fdfa';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px 0 rgba(20, 184, 166, 0.15)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'white';
                  e.currentTarget.style.transform = 'translateY(0px)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <h4 style={styles.actionTitle}>
                  Document Expiry Tracker
                </h4>
                <p style={styles.actionDescription}>
                  Monitor certifications and wage premiums
                </p>
              </button>
            </PermissionGate>

            <PermissionGate permissions={['hr.settings.manage']} requireOwner fallback={null}>
              <button 
                onClick={() => handleNavigation('/dashboard/hr/settings')}
                style={styles.actionButton}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#f0fdfa';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px 0 rgba(20, 184, 166, 0.15)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'white';
                  e.currentTarget.style.transform = 'translateY(0px)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <h4 style={styles.actionTitle}>
                  HR Settings
                </h4>
                <p style={styles.actionDescription}>
                  Configure HR preferences
                </p>
              </button>
            </PermissionGate>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
    paddingTop: '60px',
    paddingLeft: '20px',
    paddingRight: '20px',
    paddingBottom: '20px'
  },
  loadingContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
    paddingTop: '60px',
    paddingLeft: '20px',
    paddingRight: '20px',
    paddingBottom: '20px'
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #14B8A6',
    borderTop: '3px solid transparent',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 8px auto'
  },
  loadingText: {
    margin: 0,
    color: '#6b7280',
    fontSize: '16px',
    fontWeight: '500'
  },
  errorContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
    paddingTop: '60px',
    paddingLeft: '20px',
    paddingRight: '20px',
    paddingBottom: '20px'
  },
  errorContent: {
    textAlign: 'center',
    maxWidth: '400px'
  },
  errorTitle: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#111827',
    margin: '0 0 8px 0'
  },
  errorText: {
    color: '#6b7280',
    marginBottom: '20px',
    fontSize: '16px',
    lineHeight: '1.5',
    margin: '0 0 20px 0'
  },
  backButton: {
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
  },
  header: {
    marginBottom: '30px'
  },
  mainTitle: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#111827',
    margin: '0 0 8px 0'
  },
  subtitle: {
    color: '#6b7280',
    fontSize: '16px',
    margin: 0
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '20px',
    marginBottom: '40px'
  },
  statCard: {
    backgroundColor: 'white',
    padding: '24px',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
  },
  statTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#111827',
    margin: '0 0 8px 0'
  },
  statValue: {
    fontSize: '28px',
    fontWeight: 'bold',
    margin: 0
  },
  actionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '20px'
  },
  actionButton: {
    backgroundColor: 'white',
    border: '2px solid #14B8A6',
    padding: '24px',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    textAlign: 'left',
    outline: 'none',
    minHeight: '120px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center'
  },
  actionTitle: {
    fontWeight: '600',
    color: '#374151',
    margin: '0 0 8px 0',
    fontSize: '18px'
  },
  actionDescription: {
    fontSize: '14px',
    color: '#6b7280',
    margin: 0,
    lineHeight: '1.4'
  }
};

export default HRDashboard;