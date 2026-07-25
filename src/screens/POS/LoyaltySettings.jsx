// screens/POS/LoyaltySettings.jsx - Updated with Permissions and Clean Logging
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';

// Foundation Components
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import { useAuditLog } from '../../hooks/useAuditLog';

// Permission system integration
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import ModuleDeactivationPanel from '../../components/Modules/ModuleDeactivationPanel';
import LoyaltyOfferRulesPanel from '../../components/POS/LoyaltyOfferRulesPanel';
import toast from 'react-hot-toast';
import { FiLock, FiAlertCircle } from 'react-icons/fi';

const LOYALTY_SETTINGS_TABS = ['basic', 'redemption', 'advanced', 'security', 'family', 'campaigns', 'offers'];

const LoyaltySettings = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const auditLog = useAuditLog();
  
  // Auth state will be handled by POSAuthWrapper
  const [authData, setAuthData] = useState(null);
  
  // Permission system integration
  const { 
    hasPermission, 
    hasAnyPermission,
    isOwner, 
    isManager,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks — align with POS Loyalty + POS Settings loyalty tabs
  const canViewLoyaltySettings = hasAnyPermission([
    'pos.settings.view',
    'pos.settings.edit',
    'pos.settings.loyalty',
    'pos.settings.loyalty.edit',
    'pos.loyalty.settings',
    'pos.loyalty.manage',
  ]) || hasElevatedPrivileges();
  const canEditLoyaltySettings = hasAnyPermission([
    'pos.settings.edit',
    'pos.settings.loyalty.edit',
    'pos.loyalty.settings',
    'pos.loyalty.manage',
  ]) || isOwner() || isManager();
  const canManageLoyaltyProgram = hasPermission('pos.loyalty.manage') || hasElevatedPrivileges();
  
  const [settings, setSettings] = useState({
    // Program Configuration
    loyalty_mode: 'points', // 'points' or 'dollars'
    earn_rate: 10, // 10 points per $1 or $0.10 per $1
    earn_rate_percentage: 1.0, // 1% earn rate
    redemption_rate: 10000, // 10,000 points = $10
    is_active: true,
    
    // Redemption Rules
    auto_apply: 'customer_choice', // 'always', 'never', 'customer_choice'
    min_redemption: 10000, // minimum points/dollars to redeem
    max_redemption_per_transaction: null, // max per single transaction
    max_redemption_per_day: 10000, // daily limit
    allow_partial_redemption: true, // use some points, pay rest cash
    
    // Expiration Settings
    credits_expire: true,
    expiry_months: 6,
    expiry_warning_days: 30, // warn customers X days before expiry
    
    // Earning Restrictions
    max_daily_earn: null, // daily earning cap
    max_total_balance: 100000, // maximum account balance
    blackout_dates: [], // dates when earning is disabled
    excluded_categories: [], // product categories that don't earn points
    
    // Return/Refund Policies
    refund_point_policy: 'deduct_unvested_first', // 'deduct_available_first', 'proportional'
    points_on_tax: false, // earn points on tax portion
    points_on_discounted_items: true, // earn on sale items
    
    // Family/Household Features
    allow_family_pooling: false,
    max_linked_accounts: 5,
    allow_point_transfers: false,
    
    // Bonus & Campaigns
    enable_bonus_campaigns: true,
    welcome_bonus: 500, // points for signing up
    birthday_bonus: 1000, // annual birthday bonus
    review_bonus: 100, // points for leaving reviews
    
    // Security & Fraud Prevention
    require_id_for_large_redemptions: true,
    large_redemption_threshold: 50000, // require ID above this amount
    suspicious_activity_threshold: 10000, // flag unusual earning patterns
    
    // Notifications
    email_point_summaries: true,
    sms_balance_alerts: false,
    push_expiry_warnings: true
  });
  
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(
    LOYALTY_SETTINGS_TABS.includes(tabFromUrl || '') ? tabFromUrl : 'basic',
  );

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && LOYALTY_SETTINGS_TABS.includes(tab) && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [searchParams, activeTab]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewLoyaltySettings) {
      toast.error('You do not have permission to access loyalty settings');
      navigate('/dashboard/pos');
    }
  }, [permissionsLoading, canViewLoyaltySettings, navigate]);

  // Handle auth ready callback
  const handleAuthReady = async (auth) => {
    setAuthData(auth);
    
    // Log access to loyalty settings
    await auditLog.logPOS('loyalty_settings_accessed', {
      user_role: auth.userRole,
      business_name: auth.businessData?.name,
      can_edit: canEditLoyaltySettings
    });
  };

  useEffect(() => {
    if (authData?.selectedBusinessId && !permissionsLoading) {
      if (canViewLoyaltySettings) {
        loadSettings();
      }
    }
  }, [authData?.selectedBusinessId, permissionsLoading, canViewLoyaltySettings]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      
      await auditLog.logPOS('loyalty_settings_load_start', {
        business_id: authData.selectedBusinessId
      });

      const { data, error } = await supabase
        .from('pos_loyalty_settings')
        .select('*')
        .eq('business_id', authData.selectedBusinessId)
        .single();

      if (error && error.code !== 'PGRST116') {
        await auditLog.logPOS('loyalty_settings_load_error', {
          error: error.message,
          error_code: error.code
        });
        throw error;
      }

      if (data) {
        setSettings(prevSettings => ({
          ...prevSettings,
          ...data
        }));
        
        await auditLog.logPOS('loyalty_settings_loaded', {
          settings_found: true,
          loyalty_mode: data.loyalty_mode,
          is_active: data.is_active
        });
      } else {
        await auditLog.logPOS('loyalty_settings_loaded', {
          settings_found: false,
          using_defaults: true
        });
      }
    } catch (err) {
      setError('Failed to load loyalty settings');
      toast.error('Failed to load loyalty settings');
      
      await auditLog.logPOS('loyalty_settings_load_failed', {
        error: err.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    // Permission check
    if (!canEditLoyaltySettings) {
      toast.error('You do not have permission to edit loyalty settings');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      // Get previous settings for audit comparison
      const { data: previousSettings } = await supabase
        .from('pos_loyalty_settings')
        .select('*')
        .eq('business_id', authData.selectedBusinessId)
        .single();

      await auditLog.logPOS('loyalty_settings_save_start', {
        tab: activeTab,
        changes_detected: true
      });

      const { error } = await supabase
        .from('pos_loyalty_settings')
        .upsert({
          business_id: authData.selectedBusinessId,
          ...settings,
          updated_at: new Date().toISOString()
        });

      if (error) {
        await auditLog.logPOS('loyalty_settings_save_error', {
          error: error.message,
          tab: activeTab
        });
        throw error;
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      toast.success('Loyalty settings saved successfully');

      // Log successful save with detailed changes
      await auditLog.logUpdate(
        'pos_loyalty_settings',
        authData.selectedBusinessId,
        previousSettings || {},
        settings
      );

      await auditLog.logPOS('loyalty_settings_saved', {
        tab: activeTab,
        loyalty_mode: settings.loyalty_mode,
        is_active: settings.is_active,
        earn_rate_percentage: settings.earn_rate_percentage,
        credits_expire: settings.credits_expire,
        family_pooling_enabled: settings.allow_family_pooling,
        bonus_campaigns_enabled: settings.enable_bonus_campaigns
      });

    } catch (err) {
      setError('Failed to save settings');
      toast.error('Failed to save settings');
      
      await auditLog.logPOS('loyalty_settings_save_failed', {
        error: err.message,
        tab: activeTab
      });
    } finally {
      setSaving(false);
    }
  };

  const handleInputChange = async (field, value) => {
    // Permission check for editing
    if (!canEditLoyaltySettings) {
      toast.error('You do not have permission to edit loyalty settings');
      return;
    }

    const oldValue = settings[field];
    
    setSettings(prev => {
      const newSettings = { ...prev, [field]: value };
      
      // Auto-calculate related fields when earn rate changes
      if (field === 'earn_rate_percentage') {
        if (prev.loyalty_mode === 'points') {
          newSettings.earn_rate = Math.round(value * 1000); // 1% = 10 points per $1
        } else {
          newSettings.earn_rate = value / 100; // 1% = $0.01 per $1
        }
      }
      
      return newSettings;
    });

    // Log significant setting changes
    if (['loyalty_mode', 'is_active', 'earn_rate_percentage', 'credits_expire'].includes(field)) {
      await auditLog.logPOS('loyalty_setting_changed', {
        field,
        old_value: oldValue,
        new_value: value,
        tab: activeTab
      });
    }
  };

  const handleTabChange = async (newTab) => {
    await auditLog.logPOS('loyalty_settings_tab_changed', {
      from_tab: activeTab,
      to_tab: newTab
    });
    
    setActiveTab(newTab);
    setSearchParams({ tab: newTab }, { replace: true });
  };

  // Calculate examples for display
  const calculateExamples = () => {
    const rate = settings.earn_rate_percentage;
    if (settings.loyalty_mode === 'points') {
      return {
        five: Math.round(5 * rate * 10),
        ten: Math.round(10 * rate * 10), 
        twenty: Math.round(20 * rate * 10)
      };
    } else {
      return {
        five: (5 * rate / 100).toFixed(2),
        ten: (10 * rate / 100).toFixed(2),
        twenty: (20 * rate / 100).toFixed(2)
      };
    }
  };

  const examples = calculateExamples();

  // Create styles using TavariStyles
  const styles = {
    container: {
      ...TavariStyles.layout.container
    },
    
    header: {
      marginBottom: TavariStyles.spacing.xl,
      textAlign: 'center'
    },
    
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm
    },
    
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },

    readOnlyBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      backgroundColor: TavariStyles.colors.warningBg,
      border: `2px solid ${TavariStyles.colors.warning}`,
      borderRadius: TavariStyles.borderRadius.md,
      color: TavariStyles.colors.warningText,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      marginTop: TavariStyles.spacing.md
    },

    accessDenied: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing['4xl'],
      textAlign: 'center',
      marginTop: TavariStyles.spacing['4xl']
    },

    accessDeniedIcon: {
      fontSize: '64px',
      color: TavariStyles.colors.danger,
      marginBottom: TavariStyles.spacing.lg
    },

    accessDeniedTitle: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },

    accessDeniedText: {
      fontSize: TavariStyles.typography.fontSize.md,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xl
    },

    backButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary
    },
    
    tabNav: {
      display: 'flex',
      gap: TavariStyles.spacing.xs,
      marginBottom: TavariStyles.spacing.xl,
      borderBottom: `2px solid ${TavariStyles.colors.gray200}`,
      paddingBottom: TavariStyles.spacing.md,
      flexWrap: 'wrap'
    },
    
    tabButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.sm,
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray600,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: `${TavariStyles.borderRadius.md} ${TavariStyles.borderRadius.md} 0 0`
    },
    
    tabButtonActive: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      borderColor: TavariStyles.colors.primary
    },
    
    content: {
      flex: 1,
      overflowY: 'auto',
      marginBottom: TavariStyles.spacing.xl
    },
    
    section: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing['3xl'],
      marginBottom: TavariStyles.spacing.xl
    },
    
    sectionTitle: {
      margin: `0 0 ${TavariStyles.spacing.xl} 0`,
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`,
      paddingBottom: TavariStyles.spacing.sm
    },
    
    formRow: {
      marginBottom: TavariStyles.spacing.xl
    },
    
    label: {
      ...TavariStyles.components.form.label
    },
    
    input: {
      ...TavariStyles.components.form.input,
      ':focus': {
        borderColor: TavariStyles.colors.primary,
        outline: 'none'
      }
    },

    inputDisabled: {
      ...TavariStyles.components.form.input,
      backgroundColor: TavariStyles.colors.gray100,
      cursor: 'not-allowed',
      opacity: 0.6
    },
    
    select: {
      ...TavariStyles.components.form.select,
      ':focus': {
        borderColor: TavariStyles.colors.primary,
        outline: 'none'
      }
    },

    selectDisabled: {
      ...TavariStyles.components.form.select,
      backgroundColor: TavariStyles.colors.gray100,
      cursor: 'not-allowed',
      opacity: 0.6
    },
    
    buttonGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.sm
    },
    
    toggleButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.sm,
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700,
      border: `2px solid ${TavariStyles.colors.gray300}`,
      minWidth: '60px'
    },
    
    toggleButtonActive: {
      backgroundColor: TavariStyles.colors.primary,
      borderColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },

    toggleButtonDisabled: {
      opacity: 0.5,
      cursor: 'not-allowed'
    },
    
    flexRow: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md
    },
    
    flexText: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700
    },
    
    helperText: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray500,
      marginTop: TavariStyles.spacing.xs,
      fontStyle: 'italic'
    },
    
    errorBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error
    },
    
    successBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.success
    },
    
    actions: {
      display: 'flex',
      justifyContent: 'center',
      paddingTop: TavariStyles.spacing.xl
    },
    
    saveButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      minWidth: '200px',
      ':disabled': {
        opacity: 0.6,
        cursor: 'not-allowed'
      }
    },
    
    loading: {
      ...TavariStyles.components.loading.container
    }
  };

  const LoyaltySettingsContent = () => {
    // Show loading while permissions are being checked
    if (permissionsLoading || loading) {
      return (
        <div style={styles.loading}>
          <div>{permissionsLoading ? 'Loading permissions...' : 'Loading loyalty settings...'}</div>
        </div>
      );
    }

    // Show access denied if no permission
    if (!canViewLoyaltySettings) {
      return (
        <div style={styles.container}>
          <div style={styles.accessDenied}>
            <FiLock style={styles.accessDeniedIcon} />
            <h2 style={styles.accessDeniedTitle}>Access Denied</h2>
            <p style={styles.accessDeniedText}>
              You do not have permission to access loyalty settings.
            </p>
            <p style={styles.accessDeniedText}>
              Contact your administrator to request access.
            </p>
            <button 
              style={styles.backButton}
              onClick={() => navigate('/dashboard/pos')}
            >
              Back to POS Dashboard
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.title}>Advanced Loyalty Program Settings</h2>
          <p style={styles.subtitle}>Configure your complete customer loyalty and rewards program</p>
          {!canEditLoyaltySettings && (
            <div style={styles.readOnlyBadge}>
              <FiAlertCircle />
              <span>View-Only Mode - Contact admin to make changes</span>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div style={styles.tabNav}>
          {[
            { key: 'basic', label: 'Basic Settings' },
            { key: 'redemption', label: 'Redemption Rules' },
            { key: 'advanced', label: 'Advanced Features' },
            { key: 'security', label: 'Security & Fraud' },
            { key: 'family', label: 'Family Features' },
            { key: 'campaigns', label: 'Bonus Campaigns' },
            { key: 'offers', label: 'Personalized Offers' }
          ].map(tab => (
            <button
              key={tab.key}
              style={{
                ...styles.tabButton,
                ...(activeTab === tab.key ? styles.tabButtonActive : {})
              }}
              onClick={() => handleTabChange(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={styles.content}>
          {/* Basic Settings Tab */}
          {activeTab === 'basic' && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Program Configuration</h3>
              
              <div style={styles.formRow}>
                <label style={styles.label}>Program Status</label>
                <div style={styles.buttonGroup}>
                  <button
                    style={{
                      ...styles.toggleButton,
                      ...(settings.is_active ? styles.toggleButtonActive : {}),
                      ...(!canEditLoyaltySettings ? styles.toggleButtonDisabled : {})
                    }}
                    onClick={() => handleInputChange('is_active', true)}
                    disabled={!canEditLoyaltySettings}
                  >
                    Active
                  </button>
                  <button
                    style={{
                      ...styles.toggleButton,
                      ...(!settings.is_active ? styles.toggleButtonActive : {}),
                      ...(!canEditLoyaltySettings ? styles.toggleButtonDisabled : {})
                    }}
                    onClick={() => handleInputChange('is_active', false)}
                    disabled={!canEditLoyaltySettings}
                  >
                    Inactive
                  </button>
                </div>
              </div>

              <div style={styles.formRow}>
                <label style={styles.label}>Reward Type</label>
                <select
                  value={settings.loyalty_mode}
                  onChange={(e) => handleInputChange('loyalty_mode', e.target.value)}
                  style={canEditLoyaltySettings ? styles.select : styles.selectDisabled}
                  disabled={!canEditLoyaltySettings}
                >
                  <option value="points">Points System (like PC Optimum)</option>
                  <option value="dollars">Dollar Credits</option>
                </select>
              </div>

              <div style={styles.formRow}>
                <label style={styles.label}>Earn Rate (%)</label>
                <input
                  type="number"
                  value={settings.earn_rate_percentage}
                  onChange={(e) => handleInputChange('earn_rate_percentage', parseFloat(e.target.value) || 0)}
                  step="0.1"
                  min="0"
                  max="10"
                  style={canEditLoyaltySettings ? styles.input : styles.inputDisabled}
                  disabled={!canEditLoyaltySettings}
                />
                <div style={styles.helperText}>
                  Examples: {settings.loyalty_mode === 'points' ? 
                    `$5 = ${examples.five} pts, $10 = ${examples.ten} pts, $20 = ${examples.twenty} pts` :
                    `$5 = $${examples.five}, $10 = $${examples.ten}, $20 = $${examples.twenty}`
                  }
                </div>
              </div>

              {settings.loyalty_mode === 'points' && (
                <div style={styles.formRow}>
                  <label style={styles.label}>Redemption Value</label>
                  <div style={styles.flexRow}>
                    <input
                      type="number"
                      value={settings.redemption_rate}
                      onChange={(e) => handleInputChange('redemption_rate', parseInt(e.target.value) || 10000)}
                      step="1000"
                      min="1000"
                      style={{
                        ...(canEditLoyaltySettings ? styles.input : styles.inputDisabled),
                        width: '120px'
                      }}
                      disabled={!canEditLoyaltySettings}
                    />
                    <span style={styles.flexText}>points = $10.00</span>
                  </div>
                  <div style={styles.helperText}>
                    Each point worth: ${(10 / settings.redemption_rate).toFixed(4)}
                  </div>
                </div>
              )}

              <div style={styles.formRow}>
                <TavariCheckbox
                  checked={settings.points_on_tax}
                  onChange={(checked) => handleInputChange('points_on_tax', checked)}
                  label="Earn Points on Tax"
                  size="md"
                  disabled={!canEditLoyaltySettings}
                />
              </div>

              <div style={styles.formRow}>
                <TavariCheckbox
                  checked={settings.points_on_discounted_items}
                  onChange={(checked) => handleInputChange('points_on_discounted_items', checked)}
                  label="Earn Points on Discounted Items"
                  size="md"
                  disabled={!canEditLoyaltySettings}
                />
              </div>
            </div>
          )}

          {/* Redemption Rules Tab */}
          {activeTab === 'redemption' && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Redemption Configuration</h3>
              
              <div style={styles.formRow}>
                <label style={styles.label}>Auto-Apply Policy</label>
                <select
                  value={settings.auto_apply}
                  onChange={(e) => handleInputChange('auto_apply', e.target.value)}
                  style={canEditLoyaltySettings ? styles.select : styles.selectDisabled}
                  disabled={!canEditLoyaltySettings}
                >
                  <option value="always">Always auto-apply when minimum reached</option>
                  <option value="customer_choice">Let customer choose each time</option>
                  <option value="never">Manual redemption only</option>
                </select>
              </div>

              <div style={styles.formRow}>
                <label style={styles.label}>Minimum Redemption Amount</label>
                <input
                  type="number"
                  value={settings.min_redemption}
                  onChange={(e) => handleInputChange('min_redemption', parseInt(e.target.value) || 0)}
                  step={settings.loyalty_mode === 'points' ? '1000' : '1'}
                  min="0"
                  style={canEditLoyaltySettings ? styles.input : styles.inputDisabled}
                  disabled={!canEditLoyaltySettings}
                />
                <div style={styles.helperText}>
                  {settings.loyalty_mode === 'points' ? 
                    `Minimum ${settings.min_redemption} points (${(settings.min_redemption / settings.redemption_rate * 10).toFixed(2)} value)` :
                    `Minimum $${settings.min_redemption} redemption`
                  }
                </div>
              </div>

              <div style={styles.formRow}>
                <label style={styles.label}>Maximum Per Transaction</label>
                <input
                  type="number"
                  value={settings.max_redemption_per_transaction || ''}
                  onChange={(e) => handleInputChange('max_redemption_per_transaction', e.target.value ? parseInt(e.target.value) : null)}
                  step={settings.loyalty_mode === 'points' ? '1000' : '1'}
                  min="0"
                  placeholder="No limit"
                  style={canEditLoyaltySettings ? styles.input : styles.inputDisabled}
                  disabled={!canEditLoyaltySettings}
                />
              </div>

              <div style={styles.formRow}>
                <label style={styles.label}>Maximum Per Day</label>
                <input
                  type="number"
                  value={settings.max_redemption_per_day || ''}
                  onChange={(e) => handleInputChange('max_redemption_per_day', e.target.value ? parseInt(e.target.value) : null)}
                  step={settings.loyalty_mode === 'points' ? '1000' : '1'}
                  min="0"
                  placeholder="No daily limit"
                  style={canEditLoyaltySettings ? styles.input : styles.inputDisabled}
                  disabled={!canEditLoyaltySettings}
                />
              </div>

              <div style={styles.formRow}>
                <TavariCheckbox
                  checked={settings.allow_partial_redemption}
                  onChange={(checked) => handleInputChange('allow_partial_redemption', checked)}
                  label="Allow Partial Redemption"
                  size="md"
                  disabled={!canEditLoyaltySettings}
                />
              </div>

              <div style={styles.formRow}>
                <TavariCheckbox
                  checked={settings.credits_expire}
                  onChange={(checked) => handleInputChange('credits_expire', checked)}
                  label="Credits Expire"
                  size="md"
                  disabled={!canEditLoyaltySettings}
                />
              </div>

              {settings.credits_expire && (
                <>
                  <div style={styles.formRow}>
                    <label style={styles.label}>Expiration Period (Months)</label>
                    <select
                      value={settings.expiry_months}
                      onChange={(e) => handleInputChange('expiry_months', parseInt(e.target.value))}
                      style={canEditLoyaltySettings ? styles.select : styles.selectDisabled}
                      disabled={!canEditLoyaltySettings}
                    >
                      <option value={3}>3 months</option>
                      <option value={6}>6 months</option>
                      <option value={12}>12 months</option>
                      <option value={24}>24 months</option>
                    </select>
                  </div>

                  <div style={styles.formRow}>
                    <label style={styles.label}>Expiry Warning (Days)</label>
                    <input
                      type="number"
                      value={settings.expiry_warning_days}
                      onChange={(e) => handleInputChange('expiry_warning_days', parseInt(e.target.value) || 30)}
                      min="0"
                      max="90"
                      style={canEditLoyaltySettings ? styles.input : styles.inputDisabled}
                      disabled={!canEditLoyaltySettings}
                    />
                    <div style={styles.helperText}>
                      Notify customers this many days before expiration
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Advanced Features Tab */}
          {activeTab === 'advanced' && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Advanced Configuration</h3>
              
              <div style={styles.formRow}>
                <label style={styles.label}>Daily Earning Limit</label>
                <input
                  type="number"
                  value={settings.max_daily_earn || ''}
                  onChange={(e) => handleInputChange('max_daily_earn', e.target.value ? parseInt(e.target.value) : null)}
                  step={settings.loyalty_mode === 'points' ? '100' : '1'}
                  min="0"
                  placeholder="No daily earning limit"
                  style={canEditLoyaltySettings ? styles.input : styles.inputDisabled}
                  disabled={!canEditLoyaltySettings}
                />
              </div>

              <div style={styles.formRow}>
                <label style={styles.label}>Maximum Account Balance</label>
                <input
                  type="number"
                  value={settings.max_total_balance}
                  onChange={(e) => handleInputChange('max_total_balance', parseInt(e.target.value) || 100000)}
                  step={settings.loyalty_mode === 'points' ? '10000' : '100'}
                  min="0"
                  style={canEditLoyaltySettings ? styles.input : styles.inputDisabled}
                  disabled={!canEditLoyaltySettings}
                />
                <div style={styles.helperText}>
                  Prevent unlimited point accumulation for fraud protection
                </div>
              </div>

              <div style={styles.formRow}>
                <label style={styles.label}>Return/Refund Policy</label>
                <select
                  value={settings.refund_point_policy}
                  onChange={(e) => handleInputChange('refund_point_policy', e.target.value)}
                  style={canEditLoyaltySettings ? styles.select : styles.selectDisabled}
                  disabled={!canEditLoyaltySettings}
                >
                  <option value="deduct_unvested_first">Deduct pending points first, then available</option>
                  <option value="deduct_available_first">Deduct available points first</option>
                  <option value="proportional">Deduct proportionally from both</option>
                </select>
              </div>

              <div style={styles.formRow}>
                <TavariCheckbox
                  checked={settings.email_point_summaries}
                  onChange={(checked) => handleInputChange('email_point_summaries', checked)}
                  label="Send Monthly Email Summaries"
                  size="md"
                  disabled={!canEditLoyaltySettings}
                />
              </div>

              <div style={styles.formRow}>
                <TavariCheckbox
                  checked={settings.sms_balance_alerts}
                  onChange={(checked) => handleInputChange('sms_balance_alerts', checked)}
                  label="Send SMS Balance Alerts"
                  size="md"
                  disabled={!canEditLoyaltySettings}
                />
              </div>
            </div>
          )}

          {/* Security & Fraud Tab */}
          {activeTab === 'security' && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Security & Fraud Prevention</h3>
              
              <div style={styles.formRow}>
                <TavariCheckbox
                  checked={settings.require_id_for_large_redemptions}
                  onChange={(checked) => handleInputChange('require_id_for_large_redemptions', checked)}
                  label="Require ID for Large Redemptions"
                  size="md"
                  disabled={!canEditLoyaltySettings}
                />
              </div>

              {settings.require_id_for_large_redemptions && (
                <div style={styles.formRow}>
                  <label style={styles.label}>Large Redemption Threshold</label>
                  <input
                    type="number"
                    value={settings.large_redemption_threshold}
                    onChange={(e) => handleInputChange('large_redemption_threshold', parseInt(e.target.value) || 50000)}
                    step={settings.loyalty_mode === 'points' ? '10000' : '50'}
                    min="0"
                    style={canEditLoyaltySettings ? styles.input : styles.inputDisabled}
                    disabled={!canEditLoyaltySettings}
                  />
                  <div style={styles.helperText}>
                    Require ID when redeeming above this amount in a single transaction
                  </div>
                </div>
              )}

              <div style={styles.formRow}>
                <label style={styles.label}>Suspicious Activity Threshold</label>
                <input
                  type="number"
                  value={settings.suspicious_activity_threshold}
                  onChange={(e) => handleInputChange('suspicious_activity_threshold', parseInt(e.target.value) || 10000)}
                  step={settings.loyalty_mode === 'points' ? '1000' : '10'}
                  min="0"
                  style={canEditLoyaltySettings ? styles.input : styles.inputDisabled}
                  disabled={!canEditLoyaltySettings}
                />
                <div style={styles.helperText}>
                  Flag unusual earning patterns above this daily amount
                </div>
              </div>
            </div>
          )}

          {/* Family Features Tab */}
          {activeTab === 'family' && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Family & Household Features</h3>
              
              <div style={styles.formRow}>
                <TavariCheckbox
                  checked={settings.allow_family_pooling}
                  onChange={(checked) => handleInputChange('allow_family_pooling', checked)}
                  label="Allow Family Account Pooling"
                  size="md"
                  disabled={!canEditLoyaltySettings}
                />
                <div style={styles.helperText}>
                  Allow families to combine points/credits
                </div>
              </div>

              {settings.allow_family_pooling && (
                <>
                  <div style={styles.formRow}>
                    <label style={styles.label}>Maximum Linked Accounts</label>
                    <input
                      type="number"
                      value={settings.max_linked_accounts}
                      onChange={(e) => handleInputChange('max_linked_accounts', parseInt(e.target.value) || 5)}
                      min="2"
                      max="10"
                      style={canEditLoyaltySettings ? styles.input : styles.inputDisabled}
                      disabled={!canEditLoyaltySettings}
                    />
                  </div>

                  <div style={styles.formRow}>
                    <TavariCheckbox
                      checked={settings.allow_point_transfers}
                      onChange={(checked) => handleInputChange('allow_point_transfers', checked)}
                      label="Allow Point Transfers Between Family Members"
                      size="md"
                      disabled={!canEditLoyaltySettings}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Bonus Campaigns Tab */}
          {activeTab === 'campaigns' && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Bonus Campaigns & Special Rewards</h3>
              
              <div style={styles.formRow}>
                <TavariCheckbox
                  checked={settings.enable_bonus_campaigns}
                  onChange={(checked) => handleInputChange('enable_bonus_campaigns', checked)}
                  label="Enable Bonus Campaigns"
                  size="md"
                  disabled={!canEditLoyaltySettings}
                />
                <div style={styles.helperText}>
                  Allow special promotions and bonus earning events
                </div>
              </div>

              {settings.enable_bonus_campaigns && (
                <>
                  <div style={styles.formRow}>
                    <label style={styles.label}>Welcome Bonus</label>
                    <input
                      type="number"
                      value={settings.welcome_bonus}
                      onChange={(e) => handleInputChange('welcome_bonus', parseInt(e.target.value) || 0)}
                      step={settings.loyalty_mode === 'points' ? '100' : '1'}
                      min="0"
                      style={canEditLoyaltySettings ? styles.input : styles.inputDisabled}
                      disabled={!canEditLoyaltySettings}
                    />
                    <div style={styles.helperText}>
                      {settings.loyalty_mode === 'points' ? 'Points' : 'Dollars'} awarded for signing up
                    </div>
                  </div>

                  <div style={styles.formRow}>
                    <label style={styles.label}>Birthday Bonus</label>
                    <input
                      type="number"
                      value={settings.birthday_bonus}
                      onChange={(e) => handleInputChange('birthday_bonus', parseInt(e.target.value) || 0)}
                      step={settings.loyalty_mode === 'points' ? '100' : '1'}
                      min="0"
                      style={canEditLoyaltySettings ? styles.input : styles.inputDisabled}
                      disabled={!canEditLoyaltySettings}
                    />
                    <div style={styles.helperText}>
                      Annual birthday reward
                    </div>
                  </div>

                  <div style={styles.formRow}>
                    <label style={styles.label}>Review Bonus</label>
                    <input
                      type="number"
                      value={settings.review_bonus}
                      onChange={(e) => handleInputChange('review_bonus', parseInt(e.target.value) || 0)}
                      step={settings.loyalty_mode === 'points' ? '10' : '0.5'}
                      min="0"
                      style={canEditLoyaltySettings ? styles.input : styles.inputDisabled}
                      disabled={!canEditLoyaltySettings}
                    />
                    <div style={styles.helperText}>
                      Reward for leaving product/service reviews
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'offers' && (
            <LoyaltyOfferRulesPanel
              businessId={authData?.selectedBusinessId}
              canEdit={canEditLoyaltySettings}
            />
          )}

          {error && (
            <div style={styles.errorBanner}>
              {error}
            </div>
          )}

          {success && (
            <div style={styles.successBanner}>
              Loyalty settings saved successfully!
            </div>
          )}

          {canEditLoyaltySettings && (
            <div style={styles.actions}>
              <button
                style={{
                  ...styles.saveButton,
                  ...(saving ? { opacity: 0.6, cursor: 'not-allowed' } : {})
                }}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save All Settings'}
              </button>
            </div>
          )}

          <ModuleDeactivationPanel moduleKey="loyalty" />
        </div>
      </div>
    );
  };

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager']} // Only owners and managers can modify loyalty settings
      requireBusiness={true}
      componentName="LoyaltySettings"
      onAuthReady={handleAuthReady}
    >
      <LoyaltySettingsContent />
    </POSAuthWrapper>
  );
};

export default LoyaltySettings;