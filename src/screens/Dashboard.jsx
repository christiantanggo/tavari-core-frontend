// Dashboard.jsx - Module Marketplace (Clover-style)
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiSettings } from 'react-icons/fi';
import { TavariStyles } from '../utils/TavariStyles';
import SessionManager from '../components/SessionManager';
import POSAuthWrapper from '../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../hooks/usePOSAuth';
import { usePermissions } from '../hooks/usePermissions';
import { useBusiness } from '../contexts/BusinessContext';
import { SecurityWrapper, useSecurityContext } from '../Security';
import PermissionGate from '../components/Auth/PermissionGate';
import { useModuleCatalog } from '../hooks/useModuleCatalog';
import ModuleCatalogService from '../services/ModuleCatalogService';
import toast from 'react-hot-toast';

// Icon mapping for modules
const iconMap = {
  'FiMail': '📧',
  'FiMusic': '🎵',
  'FiMonitor': '🖥️',
  'FiUsers': '👥',
  'FiShoppingCart': '🛒',
  'FiPackage': '📦',
  'FiStar': '⭐',
  'FiCalendar': '📅',
  'FiShoppingBag': '🛍️',
  'FiInbox': '📥',
  'FiSmartphone': '📱',
  'FiFileText': '📄'
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [isReady, setIsReady] = useState(false);

  // Get business context first
  const { business } = useBusiness();

  // Security context for dashboard access
  const {
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'Dashboard',
    sensitiveComponent: false,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  // Authentication - only after business is set
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
    requiredRoles: ['employee', 'cashier', 'manager', 'owner', 'admin'],
    requireBusiness: true,
    componentName: 'Dashboard'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Module catalog
  const { 
    activatedModules, 
    nonActivatedModules, 
    loading: modulesLoading,
    refresh: refreshModules
  } = useModuleCatalog();

  // Wait for business context and auth to be ready
  useEffect(() => {
    if (business?.id && !authLoading && selectedBusinessId && !permissionsLoading && !modulesLoading) {
      setIsReady(true);
    }
  }, [business?.id, authLoading, selectedBusinessId, permissionsLoading, modulesLoading]);

  // Log dashboard access - only when ready
  useEffect(() => {
    if (isReady && authUser && selectedBusinessId) {
      const logAccess = async () => {
        await recordAction('dashboard_access', selectedBusinessId, true);
        await logSecurityEvent('dashboard_viewed', {
          business_id: selectedBusinessId,
          user_role: userRole
        }, 'low');
      };
      logAccess();
    }
  }, [isReady, authUser, selectedBusinessId]);

  // Handle module click
  const handleModuleClick = async (module) => {
    if (module.isEnabled) {
      // Track usage for activated modules
      await ModuleCatalogService.trackModuleUsage(module.module_key);
      
      // Navigate to module dashboard
      const dashboardRoute = ModuleCatalogService.getModuleDashboardRoute(module.module_key);
      
      await recordAction('module_access', module.module_key, true);
      await logSecurityEvent('module_navigation', {
        module_key: module.module_key,
        module_name: module.module_name,
        destination: dashboardRoute,
        user_role: userRole
      }, 'low');
      
      navigate(dashboardRoute);
    } else {
      // Navigate to splash page for non-activated modules
      await recordAction('module_splash_view', module.module_key, true);
      navigate(`/dashboard/modules/${module.module_key}`);
    }
  };

  const styles = {
    container: {
      padding: TavariStyles.spacing['2xl'],
      paddingTop: '100px',
      maxWidth: '1400px',
      margin: '0 auto'
    },
    header: {
      textAlign: 'center',
      marginBottom: TavariStyles.spacing['3xl']
    },
    title: {
      fontSize: '2.5rem',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      color: TavariStyles.colors.gray600
    },
    businessInfo: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray500,
      marginTop: TavariStyles.spacing.sm,
      fontStyle: 'italic'
    },
    section: {
      marginBottom: TavariStyles.spacing['4xl']
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.lg,
      paddingBottom: TavariStyles.spacing.md,
      borderBottom: `2px solid ${TavariStyles.colors.gray200}`
    },
    modulesGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: TavariStyles.spacing.xl
    },
    moduleCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      textAlign: 'center',
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      border: '2px solid',
      backgroundColor: TavariStyles.colors.white,
      position: 'relative',
      overflow: 'hidden'
    },
    moduleCardActivated: {
      borderColor: TavariStyles.colors.primary || '#008080',
      boxShadow: `0 4px 12px ${TavariStyles.colors.primary || '#008080'}20`
    },
    moduleCardInactive: {
      borderColor: TavariStyles.colors.gray300 || '#d1d5db',
      opacity: 0.85
    },
    activatedBadge: {
      position: 'absolute',
      top: '12px',
      right: '12px',
      backgroundColor: TavariStyles.colors.success || '#10b981',
      color: TavariStyles.colors.white,
      padding: '4px 12px',
      borderRadius: TavariStyles.borderRadius.full || '9999px',
      fontSize: TavariStyles.typography.fontSize.xs || '12px',
      fontWeight: TavariStyles.typography.fontWeight.medium || '500'
    },
    iconWrapper: {
      width: '80px',
      height: '80px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '0 auto',
      marginBottom: TavariStyles.spacing.lg,
      fontSize: '48px',
      backgroundColor: TavariStyles.colors.gray50 || '#f9fafb'
    },
    moduleTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm
    },
    moduleDescription: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.md,
      lineHeight: 1.5
    },
    moduleCategory: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      textTransform: 'uppercase',
      letterSpacing: '0.5px'
    },
    loadingContainer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '400px',
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray600
    },
    emptyStateTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.md
    },
    emptyStateText: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray500
    }
  };

  // Show loading state until everything is ready
  if (!isReady || authLoading || permissionsLoading || modulesLoading) {
    return (
      <SessionManager>
        <div style={styles.loadingContainer}>
          Loading modules...
        </div>
      </SessionManager>
    );
  }

  const ModuleCard = ({ module }) => (
    <div
      style={{
        ...styles.moduleCard,
        ...(module.isEnabled ? styles.moduleCardActivated : styles.moduleCardInactive)
      }}
      onClick={() => handleModuleClick(module)}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = module.isEnabled 
          ? `0 8px 24px ${TavariStyles.colors.primary || '#008080'}30`
          : '0 8px 24px rgba(0, 0, 0, 0.1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = module.isEnabled
          ? `0 4px 12px ${TavariStyles.colors.primary || '#008080'}20`
          : 'none';
      }}
    >
      {module.isEnabled && (
        <div style={styles.activatedBadge}>Active</div>
      )}
      <div style={styles.iconWrapper}>
        {iconMap[module.icon] || '📦'}
      </div>
      <h3 style={styles.moduleTitle}>{module.module_name}</h3>
      <p style={styles.moduleDescription}>{module.description}</p>
      <div style={styles.moduleCategory}>{module.module_category}</div>
    </div>
  );

  return (
    <POSAuthWrapper
      requiredRoles={['employee', 'cashier', 'manager', 'owner', 'admin']}
      requireBusiness={true}
      componentName="Dashboard"
    >
      <SessionManager>
        <div style={styles.container}>
          <div style={styles.header}>
            <h1 style={styles.title}>Welcome to Tavari OS</h1>
            <p style={styles.subtitle}>Your complete business management platform</p>
            {businessData && (
              <p style={styles.businessInfo}>
                {businessData.name} • {userRole?.toUpperCase()}
              </p>
            )}
          </div>

          {/* Activated Modules Section */}
          {activatedModules && activatedModules.length > 0 && (
            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>Your Modules</h2>
              <div style={styles.modulesGrid}>
                {activatedModules.map((module) => (
                  <ModuleCard key={module.module_key} module={module} />
                ))}
              </div>
            </div>
          )}

          {/* Non-Activated Modules Section */}
          {nonActivatedModules && nonActivatedModules.length > 0 && (
            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>Available Modules</h2>
              <div style={styles.modulesGrid}>
                {nonActivatedModules.map((module) => (
                  <ModuleCard key={module.module_key} module={module} />
                ))}
              </div>
            </div>
          )}

          {/* Settings Card (always visible) */}
          {hasElevatedPrivileges() && (
            <div style={styles.section}>
              <div style={styles.modulesGrid}>
                <div
                  style={{
                    ...styles.moduleCard,
                    ...styles.moduleCardActivated
                  }}
                  onClick={() => navigate('/dashboard/settings')}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-4px)';
                    e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.15)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
                  }}
                >
                  <div style={styles.iconWrapper}>⚙️</div>
                  <h3 style={styles.moduleTitle}>Settings</h3>
                  <p style={styles.moduleDescription}>Business configuration and preferences</p>
                  <div style={styles.moduleCategory}>System</div>
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {(!activatedModules || activatedModules.length === 0) && 
           (!nonActivatedModules || nonActivatedModules.length === 0) && (
            <div style={styles.emptyState}>
              <div style={styles.emptyStateTitle}>No Modules Available</div>
              <div style={styles.emptyStateText}>
                Modules are being loaded. Please refresh if this persists.
              </div>
            </div>
          )}
        </div>
      </SessionManager>
    </POSAuthWrapper>
  );
};

export default Dashboard;