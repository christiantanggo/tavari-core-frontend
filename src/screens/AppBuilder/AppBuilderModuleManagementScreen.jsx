// Step 83: Create AppBuilderModuleManagementScreen.jsx
// Module enable/disable interface with descriptions and usage stats - Tavari Standards
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useAppBuilderModules } from '../../hooks/useAppBuilderModules';
import SecurityWrapper from '../../Security/SecurityWrapper.jsx';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePermissions } from '../../hooks/usePermissions';
import toast from 'react-hot-toast';
import AppBuilderModuleToggleCard from '../../components/AppBuilder/AppBuilderModuleToggleCard';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import { getContainerStyles, getCenteredContentStyles } from '../../utils/tavariLayoutUtils';

// Get styles function
const getStyles = () => {
  try {
    return {
      container: {
        minHeight: '100vh',
        backgroundColor: TavariStyles?.colors?.gray50 || '#f9fafb',
        ...getContainerStyles()
      },
      loadingContainer: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: TavariStyles?.colors?.gray50 || '#f9fafb'
      },
      loadingContent: {
        textAlign: 'center'
      },
      spinner: {
        width: '48px',
        height: '48px',
        border: `3px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
        borderTop: `3px solid ${TavariStyles?.colors?.primary || '#008080'}`,
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        margin: '0 auto'
      },
      loadingText: {
        marginTop: TavariStyles?.spacing?.lg || '16px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px'
      },
      content: {
        ...getCenteredContentStyles('1400px')
      },
      header: {
        marginBottom: TavariStyles?.spacing?.xl || '20px'
      },
      backButton: {
        display: 'flex',
        alignItems: 'center',
        gap: TavariStyles?.spacing?.sm || '8px',
        backgroundColor: 'transparent',
        border: 'none',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        cursor: 'pointer',
        marginBottom: TavariStyles?.spacing?.md || '12px',
        padding: TavariStyles?.spacing?.xs || '4px'
      },
      title: {
        fontSize: TavariStyles?.typography?.fontSize?.['3xl'] || '24px',
        fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        marginBottom: TavariStyles?.spacing?.sm || '8px',
        margin: 0
      },
      subtitle: {
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        margin: 0
      },
      categoryCard: {
        backgroundColor: TavariStyles?.colors?.white || '#ffffff',
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        boxShadow: TavariStyles?.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
        marginBottom: TavariStyles?.spacing?.xl || '20px'
      },
      categoryHeader: {
        padding: `${TavariStyles?.spacing?.md || '12px'} ${TavariStyles?.spacing?.xl || '20px'}`,
        borderBottom: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`
      },
      categoryTitle: {
        fontSize: TavariStyles?.typography?.fontSize?.xl || '18px',
        fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        margin: 0
      },
      categoryContent: {
        padding: TavariStyles?.spacing?.xl || '20px'
      },
      modulesGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: TavariStyles?.spacing?.md || '12px'
      },
      infoCard: {
        backgroundColor: TavariStyles?.colors?.infoBg || '#dbeafe',
        border: `1px solid ${TavariStyles?.colors?.info || '#2563eb'}`,
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        padding: TavariStyles?.spacing?.md || '12px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: TavariStyles?.spacing?.md || '12px'
      },
      infoTitle: {
        fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
        fontWeight: TavariStyles?.typography?.fontWeight?.medium || '500',
        color: TavariStyles?.colors?.infoText || '#2563eb',
        marginBottom: TavariStyles?.spacing?.xs || '4px',
        margin: 0
      },
      infoText: {
        fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
        color: TavariStyles?.colors?.infoText || '#2563eb',
        margin: 0
      }
    };
  } catch (e) {
    console.error('Error in getStyles:', e);
    return {};
  }
};

const AppBuilderModuleManagementScreen = () => {
  const navigate = useNavigate();
  const styles = useMemo(() => getStyles(), []);

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'AppBuilderModuleManagementScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();

  // Modules hook
  const { availableModules, enabledModules, loading, toggleModule } = useAppBuilderModules();

  const canToggle = hasPermission('appbuilder.modules.toggle') || hasElevatedPrivileges();

  const handleToggle = async (moduleKey, enabled) => {
    try {
      await toggleModule(moduleKey, enabled);
      toast.success(`Module ${enabled ? 'enabled' : 'disabled'} successfully`);
    } catch (error) {
      console.error('Error toggling module:', error);
      toast.error('Failed to toggle module');
    }
  };

  // Group modules by category
  const modulesByCategory = useMemo(() => {
    if (!availableModules || !Array.isArray(availableModules)) return {};
    return availableModules.reduce((acc, module) => {
      const category = module.module_category || 'Other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(module);
      return acc;
    }, {});
  }, [availableModules]);

  // Get enabled status for a module
  const getModuleEnabledStatus = (moduleKey) => {
    if (!enabledModules || !Array.isArray(enabledModules)) {
      return {
        enabled: false,
        usageCount: 0,
        lastUsed: null,
        trialEnabled: false,
        trialExpiresAt: null
      };
    }
    const enabled = enabledModules.find(m => m && m.module_key === moduleKey);
    return {
      enabled: enabled?.enabled || false,
      usageCount: enabled?.usage_count || 0,
      lastUsed: enabled?.last_used,
      trialEnabled: enabled?.trial_enabled || false,
      trialExpiresAt: enabled?.trial_expires_at
    };
  };

  if (auth.authLoading || loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingContent}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>Loading modules...</p>
        </div>
      </div>
    );
  }

  return (
    <SecurityWrapper>
      <div style={styles.container}>
        <div style={styles.content}>
          {/* Header */}
          <div style={styles.header}>
            <button
              onClick={() => navigate('/appbuilder')}
              style={styles.backButton}
            >
              <ArrowLeft size={20} />
              <span>Back to Dashboard</span>
            </button>
            <h1 style={styles.title}>Module Management</h1>
            <p style={styles.subtitle}>Enable or disable modules for your app</p>
          </div>

          {/* Modules by Category */}
          {Object.entries(modulesByCategory).map(([category, modules]) => (
            <div key={category} style={styles.categoryCard}>
              <div style={styles.categoryHeader}>
                <h2 style={styles.categoryTitle}>{category}</h2>
              </div>
              <div style={styles.categoryContent}>
                <div style={styles.modulesGrid}>
                  {modules && Array.isArray(modules) && modules.map((module) => {
                    if (!module || !module.id) return null;
                    const status = getModuleEnabledStatus(module.module_key);
                    return (
                      <AppBuilderModuleToggleCard
                        key={module.id}
                        module={module}
                        enabled={status.enabled}
                        usageStats={{
                          usageCount: status.usageCount,
                          lastUsed: status.lastUsed
                        }}
                        trialInfo={{
                          isTrial: status.trialEnabled,
                          expiresAt: status.trialExpiresAt
                        }}
                        onToggle={(enabled) => handleToggle(module.module_key, enabled)}
                        canToggle={canToggle}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          ))}

          {/* Info Message */}
          <div style={styles.infoCard}>
            <AlertCircle size={20} style={{ color: TavariStyles?.colors?.info || '#2563eb', marginTop: '2px' }} />
            <div>
              <h3 style={styles.infoTitle}>About Modules</h3>
              <p style={styles.infoText}>
                Enable modules to add features to your app. Disabled modules will not be visible
                to users. You can enable or disable modules at any time.
              </p>
            </div>
          </div>
        </div>
      </div>
    </SecurityWrapper>
  );
};

// Add CSS animation for spinner
if (typeof document !== 'undefined') {
  const existingStyle = document.querySelector('#module-spinner-animation');
  if (!existingStyle) {
    const style = document.createElement('style');
    style.id = 'module-spinner-animation';
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

export default AppBuilderModuleManagementScreen;
