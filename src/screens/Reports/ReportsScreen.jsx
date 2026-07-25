// screens/Reports/ReportsScreen.jsx - WITH PERMISSION SYSTEM + NO CONSOLE LOGGING
import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';

// Security & Authentication
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';

// Foundation Components
import POSReportsScreen from '../POS/POSReportsScreen';
import MusicReportsContent from './MusicReportsContent';
import { TavariStyles } from '../../utils/TavariStyles';
import CampaignAnalyticsDashboard from '../../components/Mail/CampaignAnalyticsDashboard';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';

const ReportsScreen = () => {
  const [searchParams, setSearchParams] = useSearchParams();

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
  const canViewReports =
    hasAnyPermission([
      'reports.dashboard.view',
      'pos.reports.view',
      'reports.pos.view',
      'reports.music.view',
      'reports.mail.view',
      'reports.hr.view',
      'reports.overview.view'
    ]) || hasElevatedPrivileges();
  const canExportReports =
    hasAnyPermission(['pos.reports.export', 'reports.music.edit']) || hasElevatedPrivileges();
  const canViewPOSReports =
    hasAnyPermission(['pos.reports.view', 'reports.pos.view']) || hasElevatedPrivileges();
  const canViewMusicReports = hasPermission('reports.music.view') || hasElevatedPrivileges();
  const canViewMailReports =
    hasAnyPermission(['reports.mail.view', 'mail.campaigns.view', 'mail.contacts.view']) ||
    hasElevatedPrivileges();

  const tabs = [
    { id: 'pos', name: 'POS Reports', icon: '🪙', permissions: ['pos.reports.view', 'reports.pos.view'] },
    { id: 'music', name: 'Music Reports', icon: '🎵', permissions: ['reports.music.view'] },
    { id: 'mail', name: 'Mail Reports', icon: '📧', permissions: ['reports.mail.view', 'mail.campaigns.view', 'mail.contacts.view'] },
    { id: 'hr', name: 'HR Reports', icon: '👥', disabled: true },
    { id: 'overview', name: 'Business Overview', icon: '📊', disabled: true }
  ];

  const requestedTab = searchParams.get('tab');
  const initialTab = tabs.some((tab) => tab.id === requestedTab) ? requestedTab : 'pos';
  const [activeTab, setActiveTab] = useState(initialTab);

  const hasTabAccess = (tab) => {
    if (!tab?.permissions || tab.permissions.length === 0) {
      return true;
    }

    return tab.permissions.some(permission => hasPermission(permission)) || hasElevatedPrivileges();
  };

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewReports) {
      toast.error('You do not have permission to view reports');
    }
  }, [permissionsLoading, canViewReports]);

  useEffect(() => {
    if (permissionsLoading) return;

    const requested = tabs.find((tab) => tab.id === requestedTab);
    if (!requested || requested.disabled || !hasTabAccess(requested)) {
      return;
    }

    if (requested.id !== activeTab) {
      setActiveTab(requested.id);
    }
  }, [requestedTab, permissionsLoading, activeTab, hasPermission, hasElevatedPrivileges]);

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
  }, [auth.selectedBusinessId, permissionsLoading, canViewReports, activeTab]);

  useEffect(() => {
    if (permissionsLoading) return;

    const currentTab = tabs.find(tab => tab.id === activeTab);
    const currentTabAvailable = currentTab && !currentTab.disabled && hasTabAccess(currentTab);

    if (!currentTabAvailable) {
      const firstAvailableTab = tabs.find(tab => !tab.disabled && hasTabAccess(tab));
      if (firstAvailableTab && firstAvailableTab.id !== activeTab) {
        setActiveTab(firstAvailableTab.id);
        setSearchParams({ tab: firstAvailableTab.id });
      }
    }
  }, [activeTab, permissionsLoading, hasPermission, hasElevatedPrivileges, setSearchParams]);

  const handleTabChange = async (tabId) => {
    const tab = tabs.find(t => t.id === tabId);
    
    // Check permission if tab requires one
    if (!hasTabAccess(tab)) {
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
    setSearchParams({ tab: tabId });
  };

  const primaryTabAction = canViewPOSReports
    ? { label: 'POS Reports', tabId: 'pos' }
    : canViewMusicReports
      ? { label: 'Music Reports', tabId: 'music' }
      : canViewMailReports
        ? { label: 'Mail Reports', tabId: 'mail' }
        : null;

  const styles = {
    container: {
      ...TavariStyles.layout.container,
      paddingTop: '80px'
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
    if (currentTab && !hasTabAccess(currentTab)) {
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
          <div style={styles.tabContent}>
            <PermissionGate permissions={['reports.music.view']}>
              <MusicReportsContent
                businessId={auth.selectedBusinessId}
                canEditMusicReports={canExportReports}
              />
            </PermissionGate>
          </div>
        );
      
      case 'mail':
        return (
          <div style={styles.tabContent}>
            <PermissionGate permissions={['reports.mail.view', 'mail.campaigns.view', 'mail.contacts.view']} requireAny>
              <CampaignAnalyticsDashboard
                businessId={auth.selectedBusinessId}
                embedded={true}
                isOpen={canViewMailReports}
              />
            </PermissionGate>
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
        <TavariModuleHeader
          title="Reports & Analytics"
          description="Review reporting across POS, music, mail, and upcoming cross-module analytics."
          actionLabel={primaryTabAction?.label}
          onAction={primaryTabAction ? () => handleTabChange(primaryTabAction.tabId) : undefined}
        />

        <div style={styles.tabContainer}>
          <div style={styles.tabList}>
            {tabs.map((tab) => {
              // Check if user has permission for this tab
              const hasTabPermission = hasTabAccess(tab);
              const isDisabled = tab.disabled || !hasTabPermission;

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
                  title={!hasTabPermission ? 'You do not have permission to view this report' : ''}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.name}</span>
                  {tab.disabled && <span style={{ fontSize: '10px' }}>(Soon)</span>}
                  {!hasTabPermission && <span style={{ fontSize: '10px' }}>🔒</span>}
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