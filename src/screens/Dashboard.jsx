// Dashboard.jsx - Module Marketplace (Clover-style)
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  'FiBarChart2': '📊',
  'FiPackage': '📦',
  'FiCpu': '🥤',
  'FiStar': '⭐',
  'FiCalendar': '📅',
  'FiShoppingBag': '🛍️',
  'FiInbox': '📥',
  'FiSmartphone': '📱',
  'FiFileText': '📄',
  'FiClipboard': '📋',
  'FiDollarSign': '💵',
  'FiShare2': '🔗'
};

const HEADER_BAR_PX = 60;
const BUSINESS_STRIP_PX = 48;
/** Vertical gap below business strip before main content (20px − 25% = 15px) */
const CONTENT_GAP_BELOW_STRIP_PX = 15;

function formatDashboardRole(role) {
  if (!role) return '';
  return String(role)
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

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
    requiredRoles: ['employee', 'manager', 'owner', 'admin'],
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
    businessStrip: {
      position: 'fixed',
      top: `${HEADER_BAR_PX}px`,
      left: 0,
      right: 0,
      height: `${BUSINESS_STRIP_PX}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 16px',
      boxSizing: 'border-box',
      backgroundColor: TavariStyles.colors.white,
      borderBottom: `1px solid ${TavariStyles.colors.gray200 || '#e5e7eb'}`,
      zIndex: 998,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      textAlign: 'center'
    },
    container: {
      padding: TavariStyles.spacing['2xl'],
      maxWidth: '1400px',
      margin: '0 auto'
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
      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    moduleCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.lg,
      textAlign: 'left',
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
      top: TavariStyles.spacing.sm,
      right: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.success || '#10b981',
      color: TavariStyles.colors.white,
      padding: '2px 8px',
      borderRadius: TavariStyles.borderRadius.full || '9999px',
      fontSize: TavariStyles.typography.fontSize.xs || '12px',
      fontWeight: TavariStyles.typography.fontWeight.medium || '500'
    },
    moduleCardHeaderRow: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.sm
    },
    moduleCardIcon: {
      fontSize: TavariStyles.typography.fontSize.xl,
      lineHeight: 1,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    },
    moduleTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0,
      lineHeight: TavariStyles.typography.lineHeight.tight,
      flex: 1,
      minWidth: 0
    },
    moduleDescription: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      margin: `0 0 ${TavariStyles.spacing.sm} 0`,
      lineHeight: TavariStyles.typography.lineHeight.normal
    },
    moduleCategory: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      marginTop: TavariStyles.spacing.xs
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

  const ModuleCard = ({ module, hideActiveBadge }) => (
    <div
      className="dashboard-module-card"
      style={{
        ...styles.moduleCard,
        ...(module.isEnabled ? styles.moduleCardActivated : styles.moduleCardInactive)
      }}
      onClick={() => handleModuleClick(module)}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
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
      {module.isEnabled && !hideActiveBadge && (
        <div className="dashboard-module-card-badge" style={styles.activatedBadge}>Active</div>
      )}
      <div
        className="module-card-header-row"
        style={{
          ...styles.moduleCardHeaderRow,
          ...(module.isEnabled && !hideActiveBadge ? { paddingRight: '72px' } : {})
        }}
      >
        <h3 className="module-card-title" style={styles.moduleTitle}>
          {module.module_name}
        </h3>
        <span className="module-card-icon-wrap" style={styles.moduleCardIcon} aria-hidden>
          {iconMap[module.icon] || '📦'}
        </span>
      </div>
      <p className="module-card-desc" style={styles.moduleDescription}>
        {module.description}
      </p>
      <div className="module-card-cat" style={styles.moduleCategory}>
        {module.module_category}
      </div>
    </div>
  );

  return (
    <POSAuthWrapper
      requiredRoles={['employee', 'manager', 'owner', 'admin']}
      requireBusiness={true}
      componentName="Dashboard"
    >
      <SessionManager>
        {businessData && (
          <div style={styles.businessStrip} className="dashboard-business-strip">
            {businessData.name} - {formatDashboardRole(userRole)}
          </div>
        )}
        <div
          style={{
            ...styles.container,
            paddingTop: businessData
              ? `${HEADER_BAR_PX + BUSINESS_STRIP_PX + CONTENT_GAP_BELOW_STRIP_PX}px`
              : `${HEADER_BAR_PX + 24}px`
          }}
        >
          {/* Activated Modules Section */}
          {activatedModules && activatedModules.length > 0 && (
            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>Your Active Modules</h2>
              <div className="dashboard-modules-grid" style={styles.modulesGrid}>
                {activatedModules.map((module) => (
                  <ModuleCard key={module.module_key} module={module} hideActiveBadge />
                ))}
              </div>
            </div>
          )}

          {/* Non-Activated Modules Section */}
          {nonActivatedModules && nonActivatedModules.length > 0 && (
            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>Available Modules</h2>
              <div className="dashboard-modules-grid" style={styles.modulesGrid}>
                {nonActivatedModules.map((module) => (
                  <ModuleCard key={module.module_key} module={module} />
                ))}
              </div>
            </div>
          )}

          {/* Settings Card (always visible) */}
          {hasElevatedPrivileges() && (
            <div style={styles.section}>
              <div className="dashboard-modules-grid" style={styles.modulesGrid}>
                <div
                  className="dashboard-module-card"
                  style={{
                    ...styles.moduleCard,
                    ...styles.moduleCardActivated
                  }}
                  onClick={() => navigate('/dashboard/settings')}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.15)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
                  }}
                >
                  <div className="module-card-header-row" style={styles.moduleCardHeaderRow}>
                    <h3 className="module-card-title" style={styles.moduleTitle}>Settings</h3>
                    <span className="module-card-icon-wrap" style={styles.moduleCardIcon} aria-hidden>⚙️</span>
                  </div>
                  <p className="module-card-desc" style={styles.moduleDescription}>
                    Business configuration and preferences
                  </p>
                  <div className="module-card-cat" style={styles.moduleCategory}>System</div>
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

        <style>{`
          /* Desktop: icon left, title right (DOM is title then icon) */
          .module-card-header-row.module-card-header-row {
            flex-direction: row;
          }
          .module-card-header-row .module-card-title {
            order: 2;
          }
          .module-card-header-row .module-card-icon-wrap {
            order: 1;
          }

          @media (max-width: 768px) {
            .dashboard-modules-grid {
              grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
              gap: 12px !important;
            }

            .dashboard-module-card.dashboard-module-card {
              display: flex !important;
              flex-direction: column !important;
              align-items: center !important;
              text-align: center !important;
              padding: 14px 8px 12px !important;
              justify-content: flex-start !important;
            }

            .dashboard-module-card .module-card-header-row {
              flex-direction: column !important;
              align-items: center !important;
              justify-content: flex-start !important;
              gap: 10px !important;
              margin-bottom: 0 !important;
              padding-right: 0 !important;
              width: 100%;
            }

            .dashboard-module-card .module-card-title {
              order: 0 !important;
              flex: none !important;
              width: 100% !important;
              font-size: 48px !important;
              font-weight: 700 !important;
              line-height: 1.25 !important;
              display: -webkit-box !important;
              -webkit-line-clamp: 2 !important;
              -webkit-box-orient: vertical !important;
              overflow: hidden !important;
              text-align: center !important;
              min-height: 2.5em;
            }

            .dashboard-module-card .module-card-icon-wrap {
              order: 0 !important;
              width: 56px !important;
              height: 56px !important;
              min-height: 56px !important;
              border-radius: 14px !important;
              font-size: 24px !important;
              line-height: 1 !important;
              display: flex !important;
              align-items: center !important;
              justify-content: center !important;
              background: linear-gradient(180deg, #f3f4f6 0%, #e5e7eb 100%) !important;
              box-shadow:
                inset 0 1px 0 rgba(255, 255, 255, 0.85),
                0 2px 6px rgba(0, 0, 0, 0.08) !important;
              flex-shrink: 0 !important;
            }

            .dashboard-module-card .module-card-desc,
            .dashboard-module-card .module-card-cat {
              display: none !important;
            }
          }

          @media (max-width: 380px) {
            .dashboard-modules-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            }
          }
        `}</style>
      </SessionManager>
    </POSAuthWrapper>
  );
};

export default Dashboard;