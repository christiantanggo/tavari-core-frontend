// src/screens/DigitalSignage/DigitalSignageDashboard.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiMonitor, FiUpload, FiCalendar, FiBarChart2, FiHome, FiSettings } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { useModuleSubscription } from '../../hooks/useModuleSubscription';
import { useModulesEnabled } from '../../hooks/useModuleEnabled';
import ModuleCatalogService from '../../services/ModuleCatalogService';
import toast from 'react-hot-toast';
import useDigitalSignage from '../../hooks/useDigitalSignage';
import ScreensListScreen from './ScreensListScreen';
import ContentLibraryScreen from './ContentLibraryScreen';
import ScheduleManagementScreen from './ScheduleManagementScreen';
import AnalyticsDashboard from './AnalyticsDashboard';
import ModuleSettingsTabContent from '../../components/Modules/ModuleSettingsTabContent';

const DigitalSignageDashboard = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'DigitalSignageDashboard'
  });

  // Permissions
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Security
  const security = useSecurityContext({
    enableRateLimiting: true,
    enableDeviceTracking: false,
    enableInputValidation: true,
    enableAuditLogging: true,
    componentName: 'DigitalSignageDashboard',
    sensitiveComponent: true
  });

  // Module subscription
  const subscription = useModuleSubscription('digital_signage', { autoCheck: true });
  const { modules } = useModulesEnabled(['digital_signage']);

  // Digital signage data
  const {
    screens,
    content,
    schedules,
    zones,
    loading,
    error,
    loadScreens,
    loadContent,
    loadSchedules,
    loadZones
  } = useDigitalSignage();

  // Load data on mount and track usage
  useEffect(() => {
    if (auth.selectedBusinessId) {
      // Track module usage
      ModuleCatalogService.setBusinessId(auth.selectedBusinessId);
      ModuleCatalogService.trackModuleUsage('digital_signage');
      
      loadScreens();
      loadContent();
      loadSchedules();
      loadZones();
    }
  }, [auth.selectedBusinessId]);

  // Permission checks
  const canAccessDashboard = hasAnyPermission([
    'digital_signage.dashboard.view',
    'digital_signage.screens.view',
    'digital_signage.content.view'
  ]) || hasElevatedPrivileges();

  const canViewScreens = hasPermission('digital_signage.screens.view') || hasElevatedPrivileges();
  const canViewContent = hasPermission('digital_signage.content.view') || hasElevatedPrivileges();
  const canViewSchedules = hasPermission('digital_signage.schedules.view') || hasElevatedPrivileges();
  const canViewAnalytics = hasPermission('digital_signage.analytics.view') || hasElevatedPrivileges();

  // Loading state
  if (subscription.loading || permissionsLoading || auth.authLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '400px',
        fontSize: TavariStyles?.typography?.fontSize?.lg || '18px',
        color: TavariStyles?.colors?.gray600 || '#4b5563'
      }}>
        <div>Loading...</div>
      </div>
    );
  }

  // Module access check - use modules['digital_signage'] as primary check
  // subscription.hasAccess may fail if module_tier_pricing table doesn't exist
  // If module is enabled in business_module_usage, allow access
  if (!modules['digital_signage']) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '400px',
        padding: TavariStyles?.spacing?.['4xl'] || '40px'
      }}>
        <div style={{ textAlign: 'center', padding: TavariStyles?.spacing?.['4xl'] || '40px' }}>
          <FiMonitor size={64} style={{ marginBottom: TavariStyles?.spacing?.lg || '16px', color: TavariStyles?.colors?.gray400 || '#9ca3af' }} />
          <h2 style={{
            fontSize: TavariStyles?.typography?.fontSize?.['2xl'] || '20px',
            fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
            color: TavariStyles?.colors?.gray800 || '#1f2937',
            marginBottom: TavariStyles?.spacing?.md || '12px'
          }}>Digital Signage Module Not Available</h2>
          <p style={{
            fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
            color: TavariStyles?.colors?.gray600 || '#4b5563',
            marginTop: TavariStyles?.spacing?.md || '12px'
          }}>
            Please activate the Digital Signage module to access this feature.
          </p>
        </div>
      </div>
    );
  }

  // Permission check
  if (!canAccessDashboard) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '400px',
        padding: TavariStyles?.spacing?.['4xl'] || '40px'
      }}>
        <div style={{ textAlign: 'center', padding: TavariStyles?.spacing?.['4xl'] || '40px' }}>
          <FiMonitor size={64} style={{ marginBottom: TavariStyles?.spacing?.lg || '16px', color: TavariStyles?.colors?.danger || '#ef4444' }} />
          <h2 style={{
            fontSize: TavariStyles?.typography?.fontSize?.['2xl'] || '20px',
            fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
            color: TavariStyles?.colors?.gray800 || '#1f2937',
            marginBottom: TavariStyles?.spacing?.md || '12px'
          }}>Access Denied</h2>
          <p style={{
            fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
            color: TavariStyles?.colors?.gray600 || '#4b5563',
            marginTop: TavariStyles?.spacing?.md || '12px'
          }}>
            You don't have permission to access Digital Signage.
          </p>
        </div>
      </div>
    );
  }

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
      padding: TavariStyles?.spacing?.xl || '20px',
      paddingTop: '80px',
      maxWidth: '1400px',
      margin: '0 auto',
      boxSizing: 'border-box'
    },
    header: {
      marginBottom: TavariStyles.spacing['2xl']
    },
    title: {
      fontSize: TavariStyles?.typography?.fontSize?.['3xl'] || '24px',
      fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
      color: TavariStyles?.colors?.gray800 || '#1f2937',
      marginBottom: TavariStyles?.spacing?.sm || '8px'
    },
    subtitle: {
      fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
      color: TavariStyles?.colors?.gray600 || '#4b5563'
    },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl
    },
    statCard: {
      backgroundColor: TavariStyles?.colors?.white || '#ffffff',
      borderRadius: TavariStyles?.borderRadius?.lg || '12px',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
      padding: TavariStyles?.spacing?.lg || '16px'
    },
    statValue: {
      fontSize: TavariStyles?.typography?.fontSize?.['2xl'] || '20px',
      fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
      color: TavariStyles?.colors?.gray800 || '#1f2937',
      marginBottom: TavariStyles?.spacing?.xs || '4px'
    },
    statLabel: {
      fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
      color: TavariStyles?.colors?.gray600 || '#4b5563'
    },
    quickActions: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: TavariStyles.spacing.md
    },
    actionButton: {
      backgroundColor: TavariStyles?.colors?.primary || '#008080',
      color: TavariStyles?.colors?.white || '#ffffff',
      border: 'none',
      borderRadius: TavariStyles?.borderRadius?.md || '8px',
      padding: `${TavariStyles?.spacing?.md || '12px'} ${TavariStyles?.spacing?.lg || '16px'}`,
      fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
      fontWeight: TavariStyles?.typography?.fontWeight?.medium || '500',
      cursor: 'pointer',
      transition: 'all 0.2s',
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles?.spacing?.sm || '8px',
      justifyContent: 'center'
    }
  };

  const moduleTabs = [
    { id: 'overview', label: 'Overview', icon: FiHome },
    { id: 'screens', label: 'Screens', icon: FiMonitor, visible: canViewScreens },
    { id: 'content', label: 'Content', icon: FiUpload, visible: canViewContent },
    { id: 'schedules', label: 'Schedules', icon: FiCalendar, visible: canViewSchedules },
    { id: 'analytics', label: 'Analytics', icon: FiBarChart2, visible: canViewAnalytics },
    { id: 'settings', label: 'Settings', icon: FiSettings }
  ];

  return (
    <SecurityWrapper>
      <POSAuthWrapper>
        <div style={styles.container}>
          <TavariModuleHeader
            title="Tavari Digital Signage"
            description="Manage screens, content, schedules, and analytics. Waiver kiosk idle content is managed under Schedules → Waiver Kiosks."
            actionLabel="Upload Content"
            actionIcon={<FiUpload size={18} />}
            onAction={() => setActiveTab('content')}
          />

          <TavariTabSystemComponent
            tabs={moduleTabs}
            mode="state"
            activeTab={activeTab}
            onTabChange={setActiveTab}
            ariaLabel="Digital Signage module"
          />

          {activeTab === 'overview' && (
            <div>
              <div style={styles.statsGrid}>
                <div style={styles.statCard}>
                  <div style={styles.statValue}>{screens.length}</div>
                  <div style={styles.statLabel}>Active Screens</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statValue}>{content.length}</div>
                  <div style={styles.statLabel}>Content Items</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statValue}>{schedules.length}</div>
                  <div style={styles.statLabel}>Active Schedules</div>
                </div>
                {canViewScreens && zones.length > 0 && (
                  <div style={styles.statCard}>
                    <div style={styles.statValue}>{zones.length}</div>
                    <div style={styles.statLabel}>Zones</div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: TavariStyles.spacing.xl }}>
                <h3 style={{
                  fontSize: TavariStyles?.typography?.fontSize?.xl || '18px',
                  fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
                  color: TavariStyles?.colors?.gray800 || '#1f2937',
                  marginBottom: TavariStyles?.spacing?.md || '12px'
                }}>Quick Actions</h3>
                <div style={styles.quickActions}>
                  {canViewScreens && (
                    <button
                      style={styles.actionButton}
                      onClick={() => setActiveTab('screens')}
                    >
                      <FiMonitor /> Manage Screens
                    </button>
                  )}
                  {canViewContent && (
                    <button
                      style={styles.actionButton}
                      onClick={() => setActiveTab('content')}
                    >
                      <FiUpload /> Upload Content
                    </button>
                  )}
                  {canViewSchedules && (
                    <button
                      style={styles.actionButton}
                      onClick={() => setActiveTab('schedules')}
                    >
                      <FiCalendar /> Create Schedule
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'screens' && canViewScreens && (
            <PermissionGate permission="digital_signage.screens.view">
              <ScreensListScreen embedded />
            </PermissionGate>
          )}

          {activeTab === 'content' && canViewContent && (
            <PermissionGate permission="digital_signage.content.view">
              <ContentLibraryScreen embedded />
            </PermissionGate>
          )}

          {activeTab === 'schedules' && canViewSchedules && (
            <PermissionGate permission="digital_signage.schedules.view">
              <ScheduleManagementScreen embedded />
            </PermissionGate>
          )}

          {activeTab === 'analytics' && canViewAnalytics && (
            <PermissionGate permission="digital_signage.analytics.view">
              <AnalyticsDashboard embedded />
            </PermissionGate>
          )}

          {activeTab === 'settings' && (
            <ModuleSettingsTabContent moduleKey="digital_signage" />
          )}
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default DigitalSignageDashboard;

