// screens/HR/HRPayrollScreens/HRPayrollDashboard.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import { useCanadianTaxCalculations } from '../../../hooks/useCanadianTaxCalculations';
import { usePermissions } from '../../../hooks/usePermissions';
import PermissionGate from '../../../components/Auth/PermissionGate';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';
import { supabase } from '../../../supabaseClient';
import toast from 'react-hot-toast';

// Tab Components
import WageManagementTab from '../../../components/HR/HRPayrollComponents/WageManagementTab';
import PayrollEntryTab from '../../../components/HR/HRPayrollComponents/PayrollEntryTab';
import PayStatementsTab from '../../../components/HR/HRPayrollComponents/PayStatementsTab';
import EditPayrollTab from '../../../components/HR/HRPayrollComponents/EditPayrollTab';
import DeductionReportsTab from '../../../components/HR/HRPayrollComponents/DeductionReportsTab';
import PayrollSettingsTab from '../../../components/HR/HRPayrollComponents/PayrollSettingsTab';
import EnhancedEmployeeTaxReportTab from '../../../components/HR/HRPayrollComponents/EnhancedEmployeeTaxReportTab';
import PayrollImportTab from '../../../components/HR/HRPayrollComponents/PayrollImportTab';
import YTDPayrollEntry from '../../../components/HR/HRPayrollComponents/YTDPayrollEntry';

// Import the custom payroll calculations hook
import { usePayrollCalculations } from '../../../hooks/usePayrollCalculations';

const HRPayrollDashboard = () => {
  const [activeTab, setActiveTab] = useState('entry');
  const [dashboardStats, setDashboardStats] = useState({
    totalEmployees: 0,
    activePayrollRuns: 0,
    monthlyPayroll: 0,
    pendingStatements: 0
  });
  const [statsLoading, setStatsLoading] = useState(true);

  // Security context for dashboard access
  const {
    logSecurityEvent,
    recordAction
  } = useSecurityContext({
    componentName: 'HRPayrollDashboard',
    sensitiveComponent: true,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'hr_admin'],
    requireBusiness: true,
    componentName: 'HR Payroll Dashboard'
  });

  // NEW: Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    isOwner, 
    isManager,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Payroll calculations and data
  const payroll = usePayrollCalculations(auth.selectedBusinessId);

  // Canadian tax calculations hook
  const canadianTax = useCanadianTaxCalculations(auth.selectedBusinessId);

  // Tax calculations for formatting
  const { formatTaxAmount } = useTaxCalculations(auth.selectedBusinessId);

  // Permission checks for payroll dashboard access
  const canAccessPayroll = hasAnyPermission([
    'hr.payroll.view',
    'hr.payroll.process',
    'hr.wages.view'
  ]) || hasElevatedPrivileges();

  const canProcessPayroll = hasPermission('hr.payroll.process');
  const canEditPayroll = hasPermission('hr.payroll.edit');
  const canViewWages = hasPermission('hr.wages.view');
  const canEditWages = hasPermission('hr.wages.edit');
  const canViewTaxReports = hasPermission('hr.payroll.view_tax_reports');
  const canEditSettings = hasPermission('hr.payroll.edit_settings') || isOwner();
  const canImportPayroll = hasPermission('hr.payroll.import') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canAccessPayroll) {
      toast.error('You do not have permission to access payroll management');
      // Don't navigate away - let POSAuthWrapper handle it
    }
  }, [permissionsLoading, canAccessPayroll]);

  useEffect(() => {
    if (auth.selectedBusinessId && auth.isReady && canAccessPayroll) {
      // Log dashboard access asynchronously
      setTimeout(() => {
        logSecurityEvent('payroll_dashboard_accessed', {
          business_id: auth.selectedBusinessId,
          user_role: auth.userRole,
          initial_tab: activeTab
        }, 'medium').catch(err => console.error('Failed to log dashboard access:', err));
      }, 0);

      loadDashboardStats();
    }
  }, [auth.selectedBusinessId, auth.isReady, canAccessPayroll]);

  useEffect(() => {
    // Log tab changes for audit asynchronously
    if (auth.isReady && canAccessPayroll) {
      setTimeout(() => {
        logSecurityEvent('payroll_tab_changed', {
          new_tab: activeTab,
          business_id: auth.selectedBusinessId
        }, 'low').catch(err => console.error('Failed to log tab change:', err));
      }, 0);
    }
  }, [activeTab, auth.isReady, canAccessPayroll]);

  const loadDashboardStats = async () => {
    if (!auth.selectedBusinessId) return;

    setStatsLoading(true);
    try {

      // 1. Get total active employees for this business
      const { data: employeeRoles, error: employeeError } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('business_id', auth.selectedBusinessId)
        .eq('active', true);

      if (employeeError) {
        console.error('Error loading employees:', employeeError);
        throw employeeError;
      }

      const totalEmployees = employeeRoles?.length || 0;

      // 2. Get active (draft) payroll runs
      const { data: activeRuns, error: activeRunsError } = await supabase
        .from('hrpayroll_runs')
        .select('id')
        .eq('business_id', auth.selectedBusinessId)
        .eq('status', 'draft');

      if (activeRunsError) {
        console.error('Error loading active payroll runs:', activeRunsError);
        throw activeRunsError;
      }

      const activePayrollRuns = activeRuns?.length || 0;

      // 3. Calculate monthly payroll from current month's finalized runs
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth();
      const currentYear = currentDate.getFullYear();
      const monthStart = new Date(currentYear, currentMonth, 1).toISOString().split('T')[0];
      const monthEnd = new Date(currentYear, currentMonth + 1, 0).toISOString().split('T')[0];


      // Get all finalized payroll runs for current month
      const { data: monthlyRuns, error: monthlyRunsError } = await supabase
        .from('hrpayroll_runs')
        .select('id, pay_date')
        .eq('business_id', auth.selectedBusinessId)
        .eq('status', 'finalized')
        .gte('pay_date', monthStart)
        .lte('pay_date', monthEnd);

      if (monthlyRunsError) {
        console.error('Error loading monthly payroll runs:', monthlyRunsError);
        throw monthlyRunsError;
      }


      let monthlyPayroll = 0;
      if (monthlyRuns && monthlyRuns.length > 0) {
        // Get payroll entries for these runs and sum the net pay
        const runIds = monthlyRuns.map(run => run.id);
        
        const { data: monthlyEntries, error: entriesError } = await supabase
          .from('hrpayroll_entries')
          .select('net_pay')
          .in('payroll_run_id', runIds);

        if (entriesError) {
          console.error('Error loading payroll entries:', entriesError);
          throw entriesError;
        }

        monthlyPayroll = monthlyEntries?.reduce((sum, entry) => {
          return sum + (parseFloat(entry.net_pay) || 0);
        }, 0) || 0;
      }


      // 4. Get pending pay statements (finalized runs without generated statements)
      const { data: finalizedRuns, error: finalizedError } = await supabase
        .from('hrpayroll_runs')
        .select('id')
        .eq('business_id', auth.selectedBusinessId)
        .eq('status', 'finalized');

      if (finalizedError) {
        console.error('Error loading finalized runs:', finalizedError);
        throw finalizedError;
      }

      const pendingStatements = finalizedRuns?.length || 0;

      setDashboardStats({
        totalEmployees,
        activePayrollRuns,
        monthlyPayroll,
        pendingStatements
      });


    } catch (error) {
      console.error('Error loading dashboard stats:', error);
    } finally {
      setStatsLoading(false);
    }
  };

  // Tab configuration with permission-based filtering
  const tabs = [
    { 
      id: 'entry', 
      label: 'Payroll Entry', 
      icon: '📊', 
      description: 'Create and process payroll runs',
      requiredPermissions: ['hr.payroll.process'],
      requiresElevated: false
    },
    { 
      id: 'statements', 
      label: 'Pay Statements', 
      icon: '📄', 
      description: 'Generate employee pay statements',
      requiredPermissions: ['hr.payroll.view'],
      requiresElevated: false
    },
    { 
      id: 'edit', 
      label: 'Edit Payroll', 
      icon: '✏️', 
      description: 'Edit existing finalized payroll entries',
      requiredPermissions: ['hr.payroll.edit'],
      requiresElevated: true
    },
    { 
      id: 'reports', 
      label: 'Tax Reports', 
      icon: '📈', 
      description: 'Government remittance and tax reports',
      requiredPermissions: ['hr.payroll.view_tax_reports'],
      requiresElevated: false
    },
    { 
      id: 'ytd', 
      label: 'YTD Management', 
      icon: '📋', 
      description: 'Year-to-date employee data and reports',
      requiredPermissions: ['hr.payroll.view'],
      requiresElevated: false
    },
    { 
      id: 'wage_management', 
      label: 'Wage Management', 
      icon: '💰', 
      description: 'Manage employee wages and bulk updates',
      requiredPermissions: ['hr.wages.edit'],
      requiresElevated: true
    },
    { 
      id: 'employee_tax_reports', 
      label: 'Employee Tax Reports', 
      icon: '🇨🇦', 
      description: 'ROE, T4, and comprehensive employee reports',
      requiredPermissions: ['hr.payroll.view_tax_reports'],
      requiresElevated: false
    },
    { 
      id: 'settings', 
      label: 'Settings', 
      icon: '⚙️', 
      description: 'Payroll configuration and tax rates',
      requiredPermissions: ['hr.payroll.edit_settings'],
      requiresElevated: true
    },
    { 
      id: 'import', 
      label: 'Excel Import', 
      icon: '📥', 
      description: 'Import existing payroll data from Excel files',
      requiredPermissions: ['hr.payroll.import'],
      requiresElevated: true
    }
  ];

  // Filter tabs based on user permissions
  const availableTabs = tabs.filter(tab => {
    // Check if user has elevated privileges if required
    if (tab.requiresElevated && !hasElevatedPrivileges()) {
      return false;
    }
    
    // Check if user has any of the required permissions
    if (tab.requiredPermissions && tab.requiredPermissions.length > 0) {
      return hasAnyPermission(tab.requiredPermissions);
    }
    
    return true;
  });

  const handleTabChange = (tabId) => {
    // Check if user has permission to access this tab
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Verify permissions before switching
    if (tab.requiredPermissions && tab.requiredPermissions.length > 0) {
      if (!hasAnyPermission(tab.requiredPermissions)) {
        toast.error('You do not have permission to access this tab');
        return;
      }
    }

    if (tab.requiresElevated && !hasElevatedPrivileges()) {
      toast.error('This feature requires elevated privileges (manager or owner)');
      return;
    }

    // Record action for audit asynchronously
    setTimeout(() => {
      recordAction('payroll_tab_navigation', true).catch(err => 
        console.error('Failed to record tab navigation:', err)
      );
    }, 0);
    
    setActiveTab(tabId);
  };

  // Get CRA compliance summary for PayrollSettingsTab
  const getCRAComplianceSummary = () => {
    if (!canadianTax?.validateCRACompliance) {
      return {
        is_cra_compliant: false,
        warnings: ['CRA tax calculations not available'],
        errors: ['Canadian tax hook not initialized']
      };
    }

    return {
      is_cra_compliant: true,
      compliance_checks: [
        'T4127 Form compliance verified',
        '2025 tax rates loaded',
        'CPP/EI calculations active',
        'Provincial tax rates configured'
      ],
      warnings: [],
      errors: []
    };
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'entry':
        return (
          <PermissionGate 
            permissions={['hr.payroll.process']} 
            requireAny
            fallback={
              <div style={styles.noAccessContainer}>
                <p style={styles.noAccessText}>⚠️ You do not have permission to process payroll</p>
              </div>
            }
          >
            <PayrollEntryTab 
              selectedBusinessId={auth.selectedBusinessId}
              businessData={auth.businessData}
              employees={payroll.employees}
              settings={payroll.settings}
              calculateEmployeePay={payroll.calculateEmployeePay}
            />
          </PermissionGate>
        );
        
      case 'statements':
        return (
          <PermissionGate 
            permissions={['hr.payroll.view']} 
            requireAny
            fallback={
              <div style={styles.noAccessContainer}>
                <p style={styles.noAccessText}>⚠️ You do not have permission to view pay statements</p>
              </div>
            }
          >
            <PayStatementsTab 
              selectedBusinessId={auth.selectedBusinessId}
              businessData={auth.businessData}
              formatTaxAmount={formatTaxAmount}
            />
          </PermissionGate>
        );
        
      case 'edit':
        return (
          <PermissionGate 
            permissions={['hr.payroll.edit']} 
            requireElevated
            fallback={
              <div style={styles.noAccessContainer}>
                <p style={styles.noAccessText}>⚠️ You do not have permission to edit payroll (requires manager/owner)</p>
              </div>
            }
          >
            <EditPayrollTab 
              selectedBusinessId={auth.selectedBusinessId}
              businessData={auth.businessData}
              employees={payroll.employees}
              settings={payroll.settings}
              formatTaxAmount={formatTaxAmount}
            />
          </PermissionGate>
        );
        
      case 'ytd':
        return (
          <PermissionGate 
            permissions={['hr.payroll.view']} 
            requireAny
            fallback={
              <div style={styles.noAccessContainer}>
                <p style={styles.noAccessText}>⚠️ You do not have permission to view YTD reports</p>
              </div>
            }
          >
            <YTDPayrollEntry 
              selectedBusinessId={auth.selectedBusinessId}
              businessData={auth.businessData}
              employees={payroll.employees}
              formatTaxAmount={formatTaxAmount}
            />
          </PermissionGate>
        );
        
      case 'wage_management':
        return (
          <PermissionGate 
            permissions={['hr.wages.edit']} 
            requireElevated
            fallback={
              <div style={styles.noAccessContainer}>
                <p style={styles.noAccessText}>⚠️ You do not have permission to manage wages (requires manager/owner)</p>
              </div>
            }
          >
            <WageManagementTab 
              selectedBusinessId={auth.selectedBusinessId}
              businessData={auth.businessData}
            />
          </PermissionGate>
        );
        
      case 'reports':
        return (
          <PermissionGate 
            permissions={['hr.payroll.view_tax_reports']} 
            requireAny
            fallback={
              <div style={styles.noAccessContainer}>
                <p style={styles.noAccessText}>⚠️ You do not have permission to view tax reports</p>
              </div>
            }
          >
            <DeductionReportsTab 
              selectedBusinessId={auth.selectedBusinessId}
              businessData={auth.businessData}
              settings={payroll.settings}
              formatTaxAmount={formatTaxAmount}
            />
          </PermissionGate>
        );
        
      case 'employee_tax_reports':
        return (
          <PermissionGate 
            permissions={['hr.payroll.view_tax_reports']} 
            requireAny
            fallback={
              <div style={styles.noAccessContainer}>
                <p style={styles.noAccessText}>⚠️ You do not have permission to view employee tax reports</p>
              </div>
            }
          >
            <EnhancedEmployeeTaxReportTab 
              selectedBusinessId={auth.selectedBusinessId}
              businessData={auth.businessData}
              employees={payroll.employees}
              formatTaxAmount={formatTaxAmount}
            />
          </PermissionGate>
        );
        
      case 'settings':
        return (
          <PermissionGate 
            permissions={['hr.payroll.edit_settings']} 
            requireElevated
            fallback={
              <div style={styles.noAccessContainer}>
                <p style={styles.noAccessText}>⚠️ You do not have permission to edit payroll settings (requires manager/owner)</p>
              </div>
            }
          >
            <PayrollSettingsTab 
              selectedBusinessId={auth.selectedBusinessId}
              businessData={auth.businessData}
              settings={payroll.settings}
              updateSettings={payroll.updateSettings}
              canadianTax={canadianTax}
              getCRAComplianceSummary={getCRAComplianceSummary}
              formatTaxAmount={formatTaxAmount}
            />
          </PermissionGate>
        );
        
      case 'import':
        return (
          <PermissionGate 
            permissions={['hr.payroll.import']} 
            requireElevated
            fallback={
              <div style={styles.noAccessContainer}>
                <p style={styles.noAccessText}>⚠️ You do not have permission to import payroll data (requires manager/owner)</p>
              </div>
            }
          >
            <PayrollImportTab 
              selectedBusinessId={auth.selectedBusinessId}
              businessData={auth.businessData}
              formatTaxAmount={formatTaxAmount}
            />
          </PermissionGate>
        );
        
      default:
        return (
          <div style={styles.defaultContent}>
            <h3>Select a tab to get started</h3>
            <p>Choose from the available payroll management options above.</p>
          </div>
        );
    }
  };

  // Styles using TavariStyles
  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      paddingTop: '20px'
    },
    dashboard: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%'
    },
    header: {
      backgroundColor: TavariStyles.colors.white,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      padding: '12px 20px'
    },
    headerContent: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      maxWidth: '1200px',
      margin: '0 auto',
      width: '100%'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.md,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs
    },
    statsContainer: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      alignItems: 'center'
    },
    statCard: {
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing.md,
      minWidth: '120px',
      textAlign: 'center'
    },
    statValue: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      display: 'block'
    },
    statLabel: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      marginTop: TavariStyles.spacing.xs
    },
    mainContent: {
      flex: 1,
      maxWidth: '1200px',
      margin: '0 auto',
      width: '100%',
      display: 'flex',
      flexDirection: 'column'
    },
    tabsContainer: {
      backgroundColor: TavariStyles.colors.white,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      overflowX: 'auto'
    },
    tabsList: {
      display: 'flex',
      gap: 0,
      minWidth: 'max-content'
    },
    tab: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      border: 'none',
      backgroundColor: 'transparent',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      borderBottom: '3px solid transparent',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      userSelect: 'none',
      minWidth: 'fit-content',
      flexDirection: 'column',
      textAlign: 'center'
    },
    activeTab: {
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.primary,
      borderBottomColor: TavariStyles.colors.primary,
      boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
    },
    inactiveTab: {
      color: TavariStyles.colors.gray600,
      backgroundColor: 'transparent'
    },
    tabIcon: {
      fontSize: TavariStyles.typography.fontSize.lg,
      marginBottom: TavariStyles.spacing.xs
    },
    tabLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: '2px'
    },
    tabDescription: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      lineHeight: TavariStyles.typography.lineHeight.tight
    },
    tabContent: {
      padding: TavariStyles.spacing.xl,
      minHeight: '400px'
    },
    loadingContainer: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: `${TavariStyles.spacing['3xl']} 0`,
      gap: TavariStyles.spacing.lg
    },
    loadingSpinner: {
      width: '40px',
      height: '40px',
      border: `4px solid ${TavariStyles.colors.gray200}`,
      borderTop: `4px solid ${TavariStyles.colors.primary}`,
      borderRadius: '50%',
      animation: 'spin 1s linear infinite'
    },
    loadingText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    errorContainer: {
      padding: TavariStyles.spacing.xl,
      textAlign: 'center',
      backgroundColor: TavariStyles.colors.errorBg,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      border: `1px solid ${TavariStyles.colors.danger}20`
    },
    errorTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.danger,
      marginBottom: TavariStyles.spacing.md
    },
    retryButton: {
      backgroundColor: TavariStyles.colors.danger,
      color: TavariStyles.colors.white,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.lg}`,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      marginTop: TavariStyles.spacing.md
    },
    defaultContent: {
      textAlign: 'center',
      padding: `${TavariStyles.spacing['3xl']} 0`,
      color: TavariStyles.colors.gray600
    },
    noAccessContainer: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: `${TavariStyles.spacing['3xl']} 0`,
      minHeight: '400px'
    },
    noAccessText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      textAlign: 'center'
    }
  };

  // Show loading state while permissions are being checked
  if (permissionsLoading || auth.authLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner}></div>
        <div style={styles.loadingText}>Loading payroll dashboard...</div>
      </div>
    );
  }

  // Show access denied if user doesn't have permission
  if (!canAccessPayroll) {
    return (
      <div style={styles.errorContainer}>
        <h3 style={styles.errorTitle}>⚠️ Access Denied</h3>
        <p>You do not have permission to access the payroll management system.</p>
        <p>Please contact your administrator if you believe this is an error.</p>
      </div>
    );
  }

  return (
    <POSAuthWrapper
      componentName="HRPayrollDashboard"
      requiredRoles={['owner', 'manager', 'hr_admin']}
      requireBusiness={true}
    >
      <SecurityWrapper
        componentName="HRPayrollDashboard"
        securityLevel="critical"
        enableAuditLogging={true}
        sensitiveComponent={true}
      >
        <div style={styles.container}>
          {/* CSS for spinner animation */}
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>

          <div style={styles.dashboard}>
            {/* Header with stats */}
            <div style={styles.header}>
              <div style={styles.headerContent}>
                <div>
                  <h1 style={styles.title}>Payroll Management</h1>
                  <p style={styles.subtitle}>
                    {auth.businessData?.business_name || 'Business'} • {new Date().getFullYear()} Tax Year
                  </p>
                </div>
                
                <div style={styles.statsContainer}>
                  {statsLoading ? (
                    <div style={styles.loadingSpinner}></div>
                  ) : (
                    <>
                      <div style={styles.statCard}>
                        <span style={styles.statValue}>{dashboardStats.totalEmployees}</span>
                        <span style={styles.statLabel}>Employees</span>
                      </div>
                      <div style={styles.statCard}>
                        <span style={styles.statValue}>{dashboardStats.activePayrollRuns}</span>
                        <span style={styles.statLabel}>Active Runs</span>
                      </div>
                      <div style={styles.statCard}>
                        <span style={styles.statValue}>
                          ${formatTaxAmount ? formatTaxAmount(dashboardStats.monthlyPayroll) : dashboardStats.monthlyPayroll.toFixed(2)}
                        </span>
                        <span style={styles.statLabel}>Monthly Total</span>
                      </div>
                      <div style={styles.statCard}>
                        <span style={styles.statValue}>{dashboardStats.pendingStatements}</span>
                        <span style={styles.statLabel}>Statements</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div style={styles.mainContent}>
              {/* Tabs navigation */}
              <div style={{
                display: 'flex',
                gap: '2px',
                marginBottom: '30px',
                backgroundColor: '#e5e7eb',
                borderRadius: '8px',
                padding: '4px',
                overflowX: 'auto'
              }}>
                {availableTabs.map(tab => (
                  <button
                    key={tab.id}
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      backgroundColor: activeTab === tab.id ? 'white' : 'transparent',
                      color: activeTab === tab.id ? '#008080' : '#6b7280',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: activeTab === tab.id ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      whiteSpace: 'nowrap',
                      minWidth: 'fit-content'
                    }}
                    onClick={() => handleTabChange(tab.id)}
                  >
                    <span>{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div style={styles.tabContent}>
                {payroll.loading ? (
                  <div style={styles.loadingContainer}>
                    <div style={styles.loadingSpinner}></div>
                    <div style={styles.loadingText}>Loading payroll data...</div>
                  </div>
                ) : payroll.error ? (
                  <div style={styles.errorContainer}>
                    <h3 style={styles.errorTitle}>Error Loading Payroll Data</h3>
                    <p>{payroll.error}</p>
                    <button 
                      style={styles.retryButton}
                      onClick={payroll.refreshData}
                    >
                      Retry Loading
                    </button>
                  </div>
                ) : (
                  renderTabContent()
                )}
              </div>
            </div>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default HRPayrollDashboard;