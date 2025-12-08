// screens/POS/POSDailyDepositScreen.jsx - Daily Cash Deposit Management
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';

// Foundation Components
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { TavariStyles } from '../../utils/TavariStyles';

// Security
import { SecurityWrapper } from '../../Security';
import { useSecurityContext } from '../../Security';

// Deposit Components
import POSDepositCountComponent from '../../components/POS/POSDailyDepositScreen/POSDepositCountComponent';
import POSDepositHistoryComponent from '../../components/POS/POSDailyDepositScreen/POSDepositHistoryComponent';

const POSDailyDepositScreen = () => {
  const navigate = useNavigate();
  
  // Security context for deposit operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'POSDailyDepositScreen',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication using standardized hook
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'POSDailyDepositScreen'
  });

  // Permission system
  const {
    hasPermission,
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading
  } = usePermissions();

  // Permission checks
  const canViewDeposits = hasAnyPermission([
    'pos.deposits.view',
    'pos.deposits.create'
  ]) || hasElevatedPrivileges();

  const canCreateDeposits = hasPermission('pos.deposits.create') || hasElevatedPrivileges();
  const canViewHistory = hasPermission('pos.deposits.view_history') || hasElevatedPrivileges();

  // State management
  const [activeTab, setActiveTab] = useState('deposit');
  const [businessSettings, setBusinessSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load business settings on component mount
  useEffect(() => {
    if (auth.isReady && auth.selectedBusinessId) {
      loadBusinessSettings();
    }
  }, [auth.isReady, auth.selectedBusinessId]);

  const loadBusinessSettings = async () => {
    try {
      setLoading(true);
      
      await logSecurityEvent('daily_deposit_screen_accessed', {
        action: 'load_settings',
        business_id: auth.selectedBusinessId
      }, 'low');

      const { data: settings, error: settingsError } = await supabase
        .from('pos_settings')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .maybeSingle();

      if (settingsError && settingsError.code && settingsError.code !== 'PGRST116') {
        throw settingsError;
      }

      // Set default settings if none exist
      const defaultSettings = {
        default_float_amount: 200.00,
        max_drawer_variance: 5.00,
        require_manager_pin_for_variance: true,
        deposit_history_requires_manager: true,
        ...settings
      };

      setBusinessSettings(defaultSettings);
      
    } catch (err) {
      await logSecurityEvent('daily_deposit_load_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Failed to load business settings');
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = async (tab) => {
    // Check permissions before switching tabs
    if (tab === 'history' && !canViewHistory) {
      return;
    }
    
    if (tab === 'deposit' && !canCreateDeposits) {
      return;
    }

    await recordAction('deposit_tab_change', { new_tab: tab }, true);
    setActiveTab(tab);
  };

  // Show loading state while authentication and settings are loading
  if (!auth.isReady || loading || permissionsLoading) {
    return (
      <POSAuthWrapper
        requiredRoles={['manager', 'owner']}
        componentName="POSDailyDepositScreen"
      >
        <div style={styles.container}>
          <div style={styles.loading}>
            <div style={TavariStyles.components.loading.spinner}></div>
            <div>Loading daily deposit screen...</div>
            <style>{TavariStyles.keyframes.spin}</style>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  // Check overall access permission
  if (!canViewDeposits) {
    return (
      <POSAuthWrapper
        requiredRoles={['manager', 'owner']}
        componentName="POSDailyDepositScreen"
      >
        <div style={styles.container}>
          <div style={styles.errorContainer}>
            <h3 style={styles.errorTitle}>Access Denied</h3>
            <p style={styles.errorMessage}>
              You do not have permission to access daily deposit management.
            </p>
            <button
              style={TavariStyles.utils.merge(
                TavariStyles.components.button.base,
                TavariStyles.components.button.variants.secondary
              )}
              onClick={() => navigate('/dashboard/pos/register')}
            >
              Return to Register
            </button>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  // Show error state if settings failed to load
  if (error) {
    return (
      <POSAuthWrapper
        requiredRoles={['manager', 'owner']}
        componentName="POSDailyDepositScreen"
      >
        <div style={styles.container}>
          <div style={styles.errorContainer}>
            <h3 style={styles.errorTitle}>Error Loading Daily Deposit</h3>
            <p style={styles.errorMessage}>{error}</p>
            <button
              style={TavariStyles.utils.merge(
                TavariStyles.components.button.base,
                TavariStyles.components.button.variants.primary
              )}
              onClick={loadBusinessSettings}
            >
              Retry
            </button>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['manager', 'owner']}
        componentName="POSDailyDepositScreen"
      >
        <div style={styles.container}>
          {/* Header */}
          <div style={styles.header}>
            <div style={styles.headerContent}>
              <h1 style={styles.title}>Daily Deposit</h1>
              <p style={styles.subtitle}>
                Manage cash counting and deposit reconciliation
              </p>
            </div>
            <button
              style={TavariStyles.utils.merge(
                TavariStyles.components.button.base,
                TavariStyles.components.button.variants.secondary
              )}
              onClick={() => navigate('/dashboard/pos/register')}
            >
              Back to Register
            </button>
          </div>

          {/* Tab Navigation */}
          <div style={styles.tabContainer}>
            <div style={styles.tabNav}>
              {canCreateDeposits && (
                <button
                  style={{
                    ...styles.tab,
                    ...(activeTab === 'deposit' ? styles.activeTab : styles.inactiveTab)
                  }}
                  onClick={() => handleTabChange('deposit')}
                >
                  Current Deposit
                </button>
              )}
              {canViewHistory && (
                <button
                  style={{
                    ...styles.tab,
                    ...(activeTab === 'history' ? styles.activeTab : styles.inactiveTab)
                  }}
                  onClick={() => handleTabChange('history')}
                >
                  Deposit History
                </button>
              )}
            </div>
          </div>

          {/* Tab Content */}
          <div style={styles.tabContent}>
            {activeTab === 'deposit' && canCreateDeposits && (
              <PermissionGate
                permissions={['pos.deposits.create']}
                requireElevated
                fallback={
                  <div style={styles.noAccessContainer}>
                    <p style={styles.noAccessText}>
                      ⚠️ You do not have permission to create deposits (requires manager/owner)
                    </p>
                  </div>
                }
              >
                <POSDepositCountComponent
                  businessId={auth.selectedBusinessId}
                  userId={auth.authUser?.id}
                  businessSettings={businessSettings}
                  onDepositComplete={() => {
                    loadBusinessSettings();
                    if (canViewHistory) {
                      handleTabChange('history');
                    }
                  }}
                />
              </PermissionGate>
            )}
            
            {activeTab === 'history' && canViewHistory && (
              <PermissionGate
                permissions={['pos.deposits.view_history']}
                requireElevated
                fallback={
                  <div style={styles.noAccessContainer}>
                    <p style={styles.noAccessText}>
                      ⚠️ You do not have permission to view deposit history (requires manager/owner)
                    </p>
                  </div>
                }
              >
                <POSDepositHistoryComponent
                  businessId={auth.selectedBusinessId}
                  userId={auth.authUser?.id}
                  businessSettings={businessSettings}
                />
              </PermissionGate>
            )}
          </div>
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

// Styles using TavariStyles as foundation
const styles = {
  container: {
    ...TavariStyles.layout.container,
    padding: TavariStyles.spacing.xl,
    gap: TavariStyles.spacing.xl
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: TavariStyles.spacing.xl,
    paddingBottom: TavariStyles.spacing.lg,
    borderBottom: `2px solid ${TavariStyles.colors.gray200}`
  },

  headerContent: {
    flex: 1
  },

  title: {
    fontSize: TavariStyles.typography.fontSize['3xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    margin: 0,
    marginBottom: TavariStyles.spacing.sm
  },

  subtitle: {
    fontSize: TavariStyles.typography.fontSize.lg,
    color: TavariStyles.colors.gray600,
    margin: 0
  },

  tabContainer: {
    marginBottom: TavariStyles.spacing.xl
  },

  tabNav: {
    display: 'flex',
    borderBottom: `2px solid ${TavariStyles.colors.gray200}`,
    gap: 0
  },

  tab: {
    background: 'none',
    border: 'none',
    padding: `${TavariStyles.spacing.lg} ${TavariStyles.spacing.xl}`,
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    cursor: 'pointer',
    transition: TavariStyles.transitions.normal,
    borderBottom: '3px solid transparent',
    position: 'relative',
    top: '2px'
  },

  activeTab: {
    color: TavariStyles.colors.primary,
    borderBottomColor: TavariStyles.colors.primary,
    backgroundColor: TavariStyles.colors.white
  },

  inactiveTab: {
    color: TavariStyles.colors.gray600,
    backgroundColor: TavariStyles.colors.gray50,
    ':hover': {
      backgroundColor: TavariStyles.colors.gray100,
      color: TavariStyles.colors.gray800
    }
  },

  tabContent: {
    flex: 1,
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    overflow: 'hidden'
  },

  loading: {
    ...TavariStyles.components.loading.container,
    minHeight: '400px'
  },

  errorContainer: {
    ...TavariStyles.layout.card,
    padding: TavariStyles.spacing['3xl'],
    textAlign: 'center',
    maxWidth: '500px',
    margin: '0 auto',
    marginTop: TavariStyles.spacing['6xl']
  },

  errorTitle: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.danger,
    marginBottom: TavariStyles.spacing.lg
  },

  errorMessage: {
    fontSize: TavariStyles.typography.fontSize.lg,
    color: TavariStyles.colors.gray600,
    marginBottom: TavariStyles.spacing.xl,
    lineHeight: TavariStyles.typography.lineHeight.relaxed
  },

  noAccessContainer: {
    padding: TavariStyles.spacing['3xl'],
    textAlign: 'center'
  },

  noAccessText: {
    fontSize: TavariStyles.typography.fontSize.lg,
    color: TavariStyles.colors.gray600,
    margin: 0
  }
};

export default POSDailyDepositScreen;