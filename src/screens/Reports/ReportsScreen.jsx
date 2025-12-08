// screens/Reports/ReportsScreen.jsx - WITH PERMISSION SYSTEM + NO CONSOLE LOGGING
import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

// Security & Authentication
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';

// Foundation Components
import POSReportsScreen from '../POS/POSReportsScreen';
import { TavariStyles } from '../../utils/TavariStyles';

const ReportsScreen = () => {
  // Security context for sensitive reports access
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'ReportsScreen',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication using standardized hook
  const auth = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'employee'],
    requireBusiness: true,
    componentName: 'ReportsScreen'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    isOwner,
    isManager,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks
  const canViewReports = hasPermission('pos.reports.view') || hasElevatedPrivileges();
  const canExportReports = hasPermission('pos.reports.export') || hasElevatedPrivileges();
  const canViewPOSReports = hasPermission('pos.reports.view') || hasElevatedPrivileges();

  const [activeTab, setActiveTab] = useState('pos');

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewReports) {
      toast.error('You do not have permission to view reports');
    }
  }, [permissionsLoading, canViewReports]);

  // Log initial access
  useEffect(() => {
    if (auth.selectedBusinessId && !permissionsLoading && canViewReports) {
      logSecurityEvent('reports_screen_accessed', {
        action: 'reports_screen_loaded',
        business_id: auth.selectedBusinessId,
        user_id: auth.authUser?.id,
        initial_tab: activeTab
      }, 'low');
    }
  }, [auth.selectedBusinessId, permissionsLoading, canViewReports]);

  const tabs = [
    { id: 'pos', name: 'POS Reports', icon: '🪙', permission: 'pos.reports.view' },
    { id: 'music', name: 'Music Reports', icon: '🎵', disabled: true },
    { id: 'mail', name: 'Mail Reports', icon: '📧', disabled: true },
    { id: 'hr', name: 'HR Reports', icon: '👥', disabled: true },
    { id: 'overview', name: 'Business Overview', icon: '📊', disabled: true }
  ];

  const handleTabChange = async (tabId) => {
    const tab = tabs.find(t => t.id === tabId);
    
    // Check permission if tab requires one
    if (tab.permission && !hasPermission(tab.permission) && !hasElevatedPrivileges()) {
      toast.error(`You do not have permission to view ${tab.name}`);
      return;
    }

    await logSecurityEvent('reports_tab_changed', {
      action: 'change_tab',
      business_id: auth.selectedBusinessId,
      from_tab: activeTab,
      to_tab: tabId
    }, 'low');

    await recordAction('reports_tab_changed', auth.selectedBusinessId, true);

    setActiveTab(tabId);
  };

  const styles = {
    container: {
      ...TavariStyles.layout.container
    },
    
    header: {
      marginBottom: TavariStyles.spacing['3xl'],
      textAlign: 'center'
    },
    
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },
    
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },
    
    tabContainer: {
      marginBottom: TavariStyles.spacing.xl,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows.sm,
      overflow: 'hidden'
    },
    
    tabList: {
      display: 'flex',
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    tab: {
      flex: 1,
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      border: 'none',
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.sm,
      transition: TavariStyles.transitions.normal,
      borderRight: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    tabActive: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    
    tabDisabled: {
      opacity: 0.5,
      cursor: 'not-allowed',
      backgroundColor: TavariStyles.colors.gray100
    },
    
    tabContent: {
      minHeight: '600px'
    },
    
    placeholderContent: {
      padding: TavariStyles.spacing['4xl'],
      textAlign: 'center',
      color: TavariStyles.colors.gray500
    },
    
    comingSoon: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.lg
    },
    
    comingDescription: {
      fontSize: TavariStyles.typography.fontSize.base,
      lineHeight: TavariStyles.typography.lineHeight.relaxed,
      maxWidth: '500px',
      margin: '0 auto'
    },

    noPermission: {
      padding: TavariStyles.spacing['4xl'],
      textAlign: 'center',
      color: TavariStyles.colors.danger
    }
  };

  const renderTabContent = () => {
    // Check permission for active tab
    const currentTab = tabs.find(t => t.id === activeTab);
    if (currentTab?.permission && !hasPermission(currentTab.permission) && !hasElevatedPrivileges()) {
      return (
        <div style={styles.noPermission}>
          <h3>Access Denied</h3>
          <p>You do not have permission to view {currentTab.name}</p>
        </div>
      );
    }

    switch (activeTab) {
      case 'pos':
        return (
          <div style={styles.tabContent}>
            <PermissionGate permission="pos.reports.view">
              <POSReportsContentWrapper />
            </PermissionGate>
          </div>
        );
      
      case 'music':
        return (
          <div style={styles.placeholderContent}>
            <div style={styles.comingSoon}>Music Reports Coming Soon</div>
            <div style={styles.comingDescription}>
              Track music performance, licensing fees, playlist analytics, and venue engagement metrics.
            </div>
          </div>
        );
      
      case 'mail':
        return (
          <div style={styles.placeholderContent}>
            <div style={styles.comingSoon}>Mail Reports Coming Soon</div>
            <div style={styles.comingDescription}>
              Analyze email campaign performance, delivery rates, customer engagement, and ROI metrics.
            </div>
          </div>
        );
      
      case 'hr':
        return (
          <div style={styles.placeholderContent}>
            <div style={styles.comingSoon}>HR Reports Coming Soon</div>
            <div style={styles.comingDescription}>
              Monitor employee performance, attendance, training compliance, and workforce analytics.
            </div>
          </div>
        );
      
      case 'overview':
        return (
          <div style={styles.placeholderContent}>
            <div style={styles.comingSoon}>Business Overview Coming Soon</div>
            <div style={styles.comingDescription}>
              Comprehensive business intelligence combining data from all Tavari modules for executive insights.
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <SecurityWrapper
      componentName="ReportsScreen"
      sensitiveComponent={true}
      requireSecureConnection={false}
      securityLevel="high"
    >
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>Business Reports & Analytics</h1>
          <p style={styles.subtitle}>Comprehensive reporting across all Tavari modules</p>
        </div>

        <div style={styles.tabContainer}>
          <div style={styles.tabList}>
            {tabs.map((tab) => {
              // Check if user has permission for this tab
              const hasTabPermission = !tab.permission || hasPermission(tab.permission) || hasElevatedPrivileges();
              const isDisabled = tab.disabled || (!hasTabPermission && tab.permission);

              return (
                <button
                  key={tab.id}
                  onClick={() => !isDisabled && handleTabChange(tab.id)}
                  style={{
                    ...styles.tab,
                    ...(activeTab === tab.id ? styles.tabActive : {}),
                    ...(isDisabled ? styles.tabDisabled : {})
                  }}
                  disabled={isDisabled}
                  title={!hasTabPermission && tab.permission ? 'You do not have permission to view this report' : ''}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.name}</span>
                  {tab.disabled && <span style={{ fontSize: '10px' }}>(Soon)</span>}
                  {!hasTabPermission && tab.permission && <span style={{ fontSize: '10px' }}>🔒</span>}
                </button>
              );
            })}
          </div>

          {renderTabContent()}
        </div>
      </div>
    </SecurityWrapper>
  );
};

// Create a wrapper component that handles authentication for POSReportsScreen
const POSReportsContentWrapper = () => {
  // Security context for POS reports
  const {
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'POSReportsContentWrapper',
    sensitiveComponent: true,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'employee']}
      requireBusiness={true}
      componentName="POSReportsContent"
    >
      <POSReportsScreenContent />
    </POSAuthWrapper>
  );
};

// Component that receives auth data properly
const POSReportsScreenContent = () => {
  const [authData, setAuthData] = useState(null);

  // Security context for POS reports screen
  const {
    logSecurityEvent,
    recordAction
  } = useSecurityContext({
    componentName: 'POSReportsScreenContent',
    sensitiveComponent: true,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  const handleAuthReady = async (auth) => {
    await logSecurityEvent('pos_reports_loaded', {
      action: 'pos_reports_screen_loaded',
      business_id: auth.selectedBusinessId,
      user_id: auth.authUser?.id
    }, 'low');

    await recordAction('pos_reports_accessed', auth.selectedBusinessId, true);

    setAuthData(auth);
  };

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'employee']}
      requireBusiness={true}
      componentName="POSReportsWrapper"
      onAuthReady={handleAuthReady}
    >
      {authData ? (
        <POSReportsScreen authData={authData} />
      ) : (
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <div style={TavariStyles.components.loading.container}>
            <div style={TavariStyles.components.loading.spinner}></div>
            <div>Loading POS reports...</div>
            <style>{TavariStyles.keyframes.spin}</style>
          </div>
        </div>
      )}
    </POSAuthWrapper>
  );
};

export default ReportsScreen;