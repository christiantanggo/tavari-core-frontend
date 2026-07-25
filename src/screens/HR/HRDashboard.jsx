// screens/HR/HRDashboard.jsx - HR overview (stats + shortcuts to the three HR areas)
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';

const HRDashboard = () => {
  const navigate = useNavigate();

  const { recordAction, logSecurityEvent } = useSecurityContext({
    componentName: 'HRDashboard',
    sensitiveComponent: false,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'low',
  });

  const { selectedBusinessId, authLoading, authError } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin', 'hr_admin'],
    requireBusiness: true,
    componentName: 'HRDashboard',
  });

  const { hasAnyPermission, hasElevatedPrivileges, loading: permissionsLoading } = usePermissions();

  const [loading, setLoading] = useState(true);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [error] = useState(null);
  const [modalOpen, setModalOpen] = useState(null);
  const [employeeLists, setEmployeeLists] = useState({
    total: [],
    onProbation: [],
    newHires: [],
  });

  const canViewHRDashboard =
    hasAnyPermission(['hr.dashboard.view', 'hr.employees.view']) || hasElevatedPrivileges();

  useEffect(() => {
    if (!permissionsLoading && !canViewHRDashboard) {
      toast.error('You do not have permission to access the HR Dashboard');
      navigate('/dashboard/home');
    }
  }, [permissionsLoading, canViewHRDashboard, navigate]);

  useEffect(() => {
    if (selectedBusinessId && !authLoading && !permissionsLoading && canViewHRDashboard) {
      loadDashboardStats();
    }
  }, [selectedBusinessId, authLoading, permissionsLoading, canViewHRDashboard]);

  const loadDashboardStats = async () => {
    try {
      setLoading(true);
      await logSecurityEvent('hr_dashboard_access', { action: 'view_hr_dashboard', business_id: selectedBusinessId }, 'low');

      const { data: employees, error: empErr } = await supabase
        .from('users')
        .select(
          `
          id,
          first_name,
          last_name,
          email,
          employee_number,
          employment_status,
          status,
          hire_date,
          start_date,
          business_users!inner(business_id)
        `
        )
        .eq('business_users.business_id', selectedBusinessId);

      if (empErr) {
        console.error('Error loading employees for stats:', empErr);
        setDashboardStats({
          total_employees: 0,
          employees_on_probation: 0,
          pending_onboarding: 0,
          overdue_policies: 0,
          expiring_contracts: 0,
          expiring_documents: 0,
        });
        return;
      }

      const now = new Date();
      const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
      const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);

      const activeEmployees = employees.filter((emp) => {
        const status = emp.employment_status || emp.status || 'active';
        return status === 'active';
      });

      const employeesOnProbationList = employees.filter((emp) => {
        const status = emp.employment_status || emp.status || 'active';
        const hireDate = emp.hire_date || emp.start_date;
        if (status !== 'active' || !hireDate) return false;
        const hire = new Date(hireDate);
        return hire > ninetyDaysAgo;
      });

      const newHiresList = employees.filter((emp) => {
        const status = emp.employment_status || emp.status || 'active';
        const hireDate = emp.hire_date || emp.start_date;
        if (status !== 'active' || !hireDate) return false;
        const hire = new Date(hireDate);
        return hire > thirtyDaysAgo;
      });

      setEmployeeLists({
        total: activeEmployees,
        onProbation: employeesOnProbationList,
        newHires: newHiresList,
      });

      setDashboardStats({
        total_employees: activeEmployees.length,
        employees_on_probation: employeesOnProbationList.length,
        pending_onboarding: newHiresList.length,
        overdue_policies: 0,
        expiring_contracts: 0,
        expiring_documents: 0,
      });

      recordAction('view_dashboard_stats', selectedBusinessId);
    } catch (e) {
      console.error('Error calculating dashboard stats:', e);
      setDashboardStats({
        total_employees: 0,
        employees_on_probation: 0,
        pending_onboarding: 0,
        overdue_policies: 0,
        expiring_contracts: 0,
        expiring_documents: 0,
      });
      await logSecurityEvent('dashboard_stats_load_failed', { error_message: e.message, business_id: selectedBusinessId }, 'medium');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToDashboard = () => navigate('/dashboard/home');

  const handleStatCardClick = (cardType) => {
    if (['total', 'probation', 'newHires'].includes(cardType)) {
      setModalOpen(cardType);
    } else if (cardType === 'policies') {
      navigate('/dashboard/hr/training?tab=policies');
    } else if (cardType === 'contracts') {
      navigate('/dashboard/hr/employee-management?tab=contracts');
    } else if (cardType === 'documents') {
      navigate('/dashboard/hr/employee-management?tab=certificates');
    } else {
      toast.info('Feature coming soon');
    }
  };

  if (permissionsLoading || authLoading || loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={{ textAlign: 'center' }}>
          <div style={styles.spinner} />
          <p style={styles.loadingText}>Loading HR overview…</p>
        </div>
      </div>
    );
  }

  if (!canViewHRDashboard) {
    return (
      <div style={styles.errorContainer}>
        <div style={styles.errorContent}>
          <h2 style={styles.errorTitle}>Access Denied</h2>
          <p style={styles.errorText}>You do not have permission to access the HR module.</p>
          <button type="button" onClick={handleBackToDashboard} style={styles.backButton}>
            Return to home
          </button>
        </div>
      </div>
    );
  }

  if (authError || error) {
    return (
      <div style={styles.errorContainer}>
        <div style={styles.errorContent}>
          <h2 style={styles.errorTitle}>Error</h2>
          <p style={styles.errorText}>{authError || error}</p>
          <button type="button" onClick={handleBackToDashboard} style={styles.backButton}>
            Return to home
          </button>
        </div>
      </div>
    );
  }

  return (
    <POSAuthWrapper requiredRoles={['owner', 'manager', 'admin', 'hr_admin']} requireBusiness componentName="HRDashboard">
      <SecurityWrapper>
        <div style={styles.container}>
          <style>
            {`
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            `}
          </style>

          <TavariModuleHeader
            title="Tavari HR"
            description="Open Employee Management, Training, or HR Communications from the left navigation, or use the shortcuts below."
            actionLabel="Employee Management"
            onAction={() => navigate('/dashboard/hr/employee-management')}
          />

          <div style={styles.hubRow}>
            <div
              style={styles.hubCard}
              onClick={() => navigate('/dashboard/hr/employee-management')}
              onKeyDown={(e) => e.key === 'Enter' && navigate('/dashboard/hr/employee-management')}
              role="button"
              tabIndex={0}
            >
              <h3 style={styles.hubTitle}>Employee Management</h3>
              <p style={styles.hubDesc}>Employees, contracts, documents, discipline, and policy configuration for roles and benefits.</p>
            </div>
            <div
              style={styles.hubCard}
              onClick={() => navigate('/dashboard/hr/training')}
              onKeyDown={(e) => e.key === 'Enter' && navigate('/dashboard/hr/training')}
              role="button"
              tabIndex={0}
            >
              <h3 style={styles.hubTitle}>Training</h3>
              <p style={styles.hubDesc}>Onboarding, milestones, orientation, policies, and training.</p>
            </div>
            <div
              style={styles.hubCard}
              onClick={() => navigate('/dashboard/hr/communications')}
              onKeyDown={(e) => e.key === 'Enter' && navigate('/dashboard/hr/communications')}
              role="button"
              tabIndex={0}
            >
              <h3 style={styles.hubTitle}>HR Communications</h3>
              <p style={styles.hubDesc}>Acknowledgements, incidents, staff updates, and communication settings.</p>
            </div>
          </div>

          {dashboardStats && (
            <div style={styles.statsGrid}>
              <div
                style={{ ...styles.statCard, ...styles.clickableCard }}
                onClick={() => handleStatCardClick('total')}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 6px 0 rgba(0, 0, 0, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px 0 rgba(0, 0, 0, 0.1)';
                }}
              >
                <h3 style={styles.statTitle}>Total Employees</h3>
                <p style={{ ...styles.statValue, color: '#14B8A6' }}>{dashboardStats.total_employees}</p>
              </div>
              <div
                style={{ ...styles.statCard, ...styles.clickableCard }}
                onClick={() => handleStatCardClick('probation')}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 6px 0 rgba(0, 0, 0, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px 0 rgba(0, 0, 0, 0.1)';
                }}
              >
                <h3 style={styles.statTitle}>On Probation</h3>
                <p style={{ ...styles.statValue, color: '#f59e0b' }}>{dashboardStats.employees_on_probation}</p>
              </div>
              <div
                style={{ ...styles.statCard, ...styles.clickableCard }}
                onClick={() => handleStatCardClick('newHires')}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 6px 0 rgba(0, 0, 0, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px 0 rgba(0, 0, 0, 0.1)';
                }}
              >
                <h3 style={styles.statTitle}>New Hires (30 days)</h3>
                <p style={{ ...styles.statValue, color: '#3b82f6' }}>{dashboardStats.pending_onboarding}</p>
              </div>
              <div
                style={{ ...styles.statCard, ...styles.clickableCard }}
                onClick={() => handleStatCardClick('policies')}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 6px 0 rgba(0, 0, 0, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px 0 rgba(0, 0, 0, 0.1)';
                }}
              >
                <h3 style={styles.statTitle}>Policy Items</h3>
                <p style={{ ...styles.statValue, color: '#ef4444' }}>{dashboardStats.overdue_policies}</p>
              </div>
              <div
                style={{ ...styles.statCard, ...styles.clickableCard }}
                onClick={() => handleStatCardClick('contracts')}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 6px 0 rgba(0, 0, 0, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px 0 rgba(0, 0, 0, 0.1)';
                }}
              >
                <h3 style={styles.statTitle}>Contract Items</h3>
                <p style={{ ...styles.statValue, color: '#eab308' }}>{dashboardStats.expiring_contracts}</p>
              </div>
              <div
                style={{ ...styles.statCard, ...styles.clickableCard }}
                onClick={() => handleStatCardClick('documents')}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 6px 0 rgba(0, 0, 0, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px 0 rgba(0, 0, 0, 0.1)';
                }}
              >
                <h3 style={styles.statTitle}>Document Items</h3>
                <p style={{ ...styles.statValue, color: '#8b5cf6' }}>{dashboardStats.expiring_documents}</p>
              </div>
            </div>
          )}

          {modalOpen && (
            <EmployeeListModal
              isOpen={!!modalOpen}
              onClose={() => setModalOpen(null)}
              title={
                modalOpen === 'total' ? 'Total Employees' : modalOpen === 'probation' ? 'Employees On Probation' : 'New Hires (30 days)'
              }
              employees={modalOpen === 'total' ? employeeLists.total : modalOpen === 'probation' ? employeeLists.onProbation : employeeLists.newHires}
            />
          )}
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
    paddingTop: '80px',
    paddingLeft: '20px',
    paddingRight: '20px',
    paddingBottom: '20px',
  },
  hubRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px',
    marginBottom: '20px',
  },
  hubCard: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
    cursor: 'pointer',
    transition: 'box-shadow 0.2s ease, transform 0.2s ease',
  },
  hubTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#0f766e',
    margin: '0 0 8px 0',
  },
  hubDesc: { fontSize: '24px', color: '#6b7280', margin: 0, lineHeight: 1.4 },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
    gap: '12px',
    marginBottom: '20px',
    overflowX: 'auto',
  },
  statCard: {
    backgroundColor: 'white',
    padding: '16px',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
  },
  clickableCard: { cursor: 'pointer', transition: 'all 0.2s ease' },
  statTitle: { fontSize: '16px', fontWeight: '600', color: '#111827', margin: '0 0 6px 0' },
  statValue: { fontSize: '16px', fontWeight: 'bold', margin: 0 },
  loadingContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
    paddingTop: '60px',
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #14B8A6',
    borderTop: '3px solid transparent',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 8px auto',
  },
  loadingText: { margin: 0, color: '#6b7280', fontSize: '32px' },
  errorContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
    paddingTop: '60px',
  },
  errorContent: { textAlign: 'center', maxWidth: '400px' },
  errorTitle: { fontSize: '16px', fontWeight: '600', color: '#111827', margin: '0 0 8px 0' },
  errorText: { color: '#6b7280', fontSize: '18px' },
  backButton: {
    padding: '12px 24px',
    backgroundColor: '#14B8A6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '28px',
    fontWeight: '600',
    cursor: 'pointer',
  },
};

const EmployeeListModal = ({ isOpen, onClose, title, employees = [] }) => {
  if (!isOpen) return null;
  return (
    <div style={modalStyles.overlay} onClick={onClose} role="presentation">
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{title}</h2>
          <button type="button" style={modalStyles.closeButton} onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div style={modalStyles.content}>
          {employees.length === 0 ? (
            <div style={modalStyles.emptyState}>
              <p>No employees found</p>
            </div>
          ) : (
            <div style={modalStyles.employeeList}>
              {employees.map((employee) => (
                <div key={employee.id} style={modalStyles.employeeItem}>
                  <div style={modalStyles.employeeInfo}>
                    <div style={modalStyles.employeeName}>
                      {employee.first_name || ''} {employee.last_name || ''}
                      {employee.employee_number && ` (#${employee.employee_number})`}
                    </div>
                    {employee.email && <div style={modalStyles.employeeEmail}>{employee.email}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={modalStyles.footer}>
          <button type="button" style={modalStyles.closeButtonFooter} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const modalStyles = {
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
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    width: '90%',
    maxWidth: '600px',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px',
    borderBottom: '1px solid #e5e7eb',
  },
  title: { fontSize: '18px', fontWeight: 'bold', color: '#111827', margin: 0 },
  closeButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#6b7280',
  },
  content: { padding: '24px', overflowY: 'auto', flex: 1 },
  emptyState: { textAlign: 'center', padding: '40px', color: '#6b7280' },
  employeeList: { display: 'flex', flexDirection: 'column', gap: '8px' },
  employeeItem: {
    padding: '16px',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
  },
  employeeInfo: { display: 'flex', flexDirection: 'column', gap: '4px' },
  employeeName: { fontSize: '14px', fontWeight: '600', color: '#111827' },
  employeeEmail: { fontSize: '11px', color: '#6b7280' },
  footer: { padding: '16px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end' },
  closeButtonFooter: {
    padding: '10px 24px',
    backgroundColor: '#14B8A6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
};

export default HRDashboard;
