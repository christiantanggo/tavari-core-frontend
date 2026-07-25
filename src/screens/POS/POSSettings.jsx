// src/screens/POS/POSSettings.jsx - Production Ready with Permissions & Security
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import PermissionGate from '../../components/Auth/PermissionGate';
import { TavariStyles } from '../../utils/TavariStyles';
import { fetchPosSettingsForTerminal, savePosSettingsForTerminal, fetchPosBusinessSettings, pickDepositBusinessSettings } from '../../utils/posSettingsQuery';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';

// Tab components
import GeneralTab from './POSSettingsComponents/GeneralTab';
import PaymentsTab from './POSSettingsComponents/PaymentsTab';
import TaxesTab from './POSSettingsComponents/TaxesTab';
import ReceiptsTab from './POSSettingsComponents/ReceiptsTab';
import LoyaltyTab from './POSSettingsComponents/LoyaltyTab';
import TabsTab from './POSSettingsComponents/TabsTab';
import SecurityTab from './POSSettingsComponents/SecurityTab';
import AlertsTab from './POSSettingsComponents/AlertsTab';
import ModuleDeactivationPanel from '../../components/Modules/ModuleDeactivationPanel';

const POSSettings = () => {
  const navigate = useNavigate();

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['owner', 'manager'],
    requireBusiness: true,
    componentName: 'POSSettings'
  });

  // Security context
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'POSSettings',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Permission system
  const {
    hasPermission,
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading
  } = usePermissions();

  // Permission checks for settings tabs
  const canViewGeneralSettings = hasPermission('pos.settings.view') || hasElevatedPrivileges();
  const canEditGeneralSettings = hasPermission('pos.settings.edit') || hasElevatedPrivileges();
  const canViewPaymentSettings = hasPermission('pos.settings.payments') || hasElevatedPrivileges();
  const canEditPaymentSettings = hasPermission('pos.settings.payments.edit') || hasElevatedPrivileges();
  const canViewTaxSettings = hasPermission('pos.settings.taxes') || hasElevatedPrivileges();
  const canEditTaxSettings = hasPermission('pos.settings.taxes.edit') || hasElevatedPrivileges();
  const canViewReceiptSettings = hasPermission('pos.settings.receipts') || hasElevatedPrivileges();
  const canEditReceiptSettings = hasPermission('pos.settings.receipts.edit') || hasElevatedPrivileges();
  const canViewLoyaltySettings = hasPermission('pos.settings.loyalty') || hasElevatedPrivileges();
  const canEditLoyaltySettings = hasPermission('pos.settings.loyalty.edit') || hasElevatedPrivileges();
  const canViewTabSettings = hasPermission('pos.settings.tabs') || hasElevatedPrivileges();
  const canEditTabSettings = hasPermission('pos.settings.tabs.edit') || hasElevatedPrivileges();
  const canViewSecuritySettings = hasPermission('pos.settings.security') || hasElevatedPrivileges();
  const canEditSecuritySettings = hasPermission('pos.settings.security.edit') || hasElevatedPrivileges();
  const canViewAlertSettings = hasPermission('pos.settings.alerts') || hasElevatedPrivileges();
  const canEditAlertSettings = hasPermission('pos.settings.alerts.edit') || hasElevatedPrivileges();

  // Tax calculations hook
  const {
    taxCategories,
    loading: taxLoading,
    error: taxError,
    refreshTaxData,
    validateTaxConfiguration
  } = useTaxCalculations(auth.selectedBusinessId);

  // State
  const [activeTab, setActiveTab] = useState('general');
  const [currentTerminalId, setCurrentTerminalId] = useState(null);
  const [terminalName, setTerminalName] = useState('');
  const [settings, setSettings] = useState({
    terminal_mode: 'manual',
    pin_required: false,
    tip_enabled: true,
    default_tip_percent: 0.15,
    tax_rate: 0.00,
    service_fee: 0.00,
    receipt_footer: '',
    loyalty_mode: 'dollars',
    auto_apply_loyalty: false,
    loyalty_min_redemption: 5.00,
    loyalty_manager_override_threshold: 50.00,
    redemption_rate: 0.01,
    auto_lock_minutes: 5,
    tab_enabled: true,
    max_tab_amount: 500.00,
    require_customer_info_for_tabs: true,
    auto_close_tabs_after_hours: 24,
    tab_number_prefix: 'TAB',
    tabs_enabled: true,
    default_tab_limit: 500.00,
    max_tab_limit: 1000.00,
    tab_limit_requires_manager: true,
    tab_auto_close_hours: 24,
    tab_warning_threshold: 0.80,
    lock_on_startup: false,
    lock_after_sale: false,
    cash_variance_threshold: 10.00,
    default_float_amount: 200.00,
    max_drawer_variance: 5.00,
    require_manager_pin_for_variance: true,
    deposit_history_requires_manager: true,
    auto_delete_saved_carts_hours: 48,
    receipt_auto_print: false,
    receipt_auto_email: false,
    receipt_show_business_info: true,
    receipt_show_tax_details: true,
    receipt_paper_size: 'thermal_80mm',
    receipt_copies: 1,
    security_max_login_attempts: 3,
    security_lockout_duration: 300,
    security_require_pin_for_voids: true,
    security_require_pin_for_discounts: false,
    security_audit_all_actions: true,
    alerts_low_stock_threshold: 10,
    alerts_enable_email_notifications: true,
    alerts_enable_push_notifications: true,
    alerts_cash_variance_alert: true,
    alerts_failed_payment_alert: true,
    indian_status_gst_rate: 0.05,
    indian_status_tax_label: 'GST (Indian Status)'
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Tab permission mapping
  const TAB_PERMISSIONS = {
    general: { view: canViewGeneralSettings, edit: canEditGeneralSettings },
    payments: { view: canViewPaymentSettings, edit: canEditPaymentSettings },
    taxes: { view: canViewTaxSettings, edit: canEditTaxSettings },
    receipts: { view: canViewReceiptSettings, edit: canEditReceiptSettings },
    loyalty: { view: canViewLoyaltySettings, edit: canEditLoyaltySettings },
    tabs: { view: canViewTabSettings, edit: canEditTabSettings },
    security: { view: canViewSecuritySettings, edit: canEditSecuritySettings },
    alerts: { view: canViewAlertSettings, edit: canEditAlertSettings }
  };

  // Check if user can view current tab
  const canViewCurrentTab = () => {
    return TAB_PERMISSIONS[activeTab]?.view || false;
  };

  // Check if user can edit current tab
  const canEditCurrentTab = () => {
    return TAB_PERMISSIONS[activeTab]?.edit || false;
  };

  // Load terminal ID
  useEffect(() => {
    const storedTerminalId = localStorage.getItem('tavari_terminal_id');
    const storedTerminalName = localStorage.getItem('tavari_terminal_name');
    
    if (storedTerminalId) {
      setCurrentTerminalId(storedTerminalId);
      setTerminalName(storedTerminalName || 'Unnamed Terminal');
    }
  }, []);

  // Fetch settings
  useEffect(() => {
    if (auth.selectedBusinessId && canViewGeneralSettings) {
      fetchSettings();
    }
  }, [auth.selectedBusinessId, currentTerminalId, canViewGeneralSettings]);

  const fetchSettings = async () => {
    setLoading(true);
    setError(null);
    
    try {
      await logSecurityEvent('pos_settings_accessed', {
        action: 'fetch_settings',
        business_id: auth.selectedBusinessId,
        terminal_id: currentTerminalId,
        accessed_by: auth.authUser?.id
      }, 'low');

      let settingsData = null;

      const { data: resolvedSettings, error: settingsError } = await fetchPosSettingsForTerminal(
        auth.selectedBusinessId,
        currentTerminalId
      );

      if (settingsError && settingsError.code && settingsError.code !== 'PGRST116') {
        throw settingsError;
      }

      settingsData = resolvedSettings;

      const { data: businessSettings } = await fetchPosBusinessSettings(auth.selectedBusinessId);
      if (businessSettings) {
        settingsData = {
          ...(settingsData || {}),
          ...pickDepositBusinessSettings(businessSettings),
        };
      }

      if (settingsData) {
        setSettings({
          terminal_mode: settingsData.terminal_mode || 'manual',
          pin_required: settingsData.pin_required || false,
          tip_enabled: settingsData.tip_enabled !== undefined ? settingsData.tip_enabled : true,
          default_tip_percent: parseFloat(settingsData.default_tip_percent) || 0.15,
          tax_rate: parseFloat(settingsData.tax_rate) || 0.00,
          service_fee: parseFloat(settingsData.service_fee) || 0.00,
          receipt_footer: settingsData.receipt_footer || '',
          loyalty_mode: settingsData.loyalty_mode || 'dollars',
          auto_apply_loyalty: settingsData.auto_apply_loyalty || false,
          loyalty_min_redemption: parseFloat(settingsData.loyalty_min_redemption) || 5.00,
          loyalty_manager_override_threshold: parseFloat(settingsData.loyalty_manager_override_threshold) || 50.00,
          redemption_rate: parseFloat(settingsData.redemption_rate) || 0.01,
          auto_lock_minutes: parseInt(settingsData.auto_lock_minutes) || 5,
          tab_enabled: settingsData.tab_enabled !== undefined ? settingsData.tab_enabled : true,
          max_tab_amount: parseFloat(settingsData.max_tab_amount) || 500.00,
          require_customer_info_for_tabs: settingsData.require_customer_info_for_tabs !== undefined ? settingsData.require_customer_info_for_tabs : true,
          auto_close_tabs_after_hours: parseInt(settingsData.auto_close_tabs_after_hours) || 24,
          tab_number_prefix: settingsData.tab_number_prefix || 'TAB',
          tabs_enabled: settingsData.tabs_enabled !== undefined ? settingsData.tabs_enabled : true,
          default_tab_limit: parseFloat(settingsData.default_tab_limit) || 500.00,
          max_tab_limit: parseFloat(settingsData.max_tab_limit) || 1000.00,
          tab_limit_requires_manager: settingsData.tab_limit_requires_manager !== undefined ? settingsData.tab_limit_requires_manager : true,
          tab_auto_close_hours: parseInt(settingsData.tab_auto_close_hours) || 24,
          tab_warning_threshold: parseFloat(settingsData.tab_warning_threshold) || 0.80,
          lock_on_startup: settingsData.lock_on_startup || false,
          lock_after_sale: settingsData.lock_after_sale || false,
          cash_variance_threshold: parseFloat(settingsData.cash_variance_threshold) || 10.00,
          default_float_amount: parseFloat(settingsData.default_float_amount) || 200.00,
          max_drawer_variance: parseFloat(settingsData.max_drawer_variance) || 5.00,
          require_manager_pin_for_variance: settingsData.require_manager_pin_for_variance !== undefined ? settingsData.require_manager_pin_for_variance : true,
          deposit_history_requires_manager: settingsData.deposit_history_requires_manager !== undefined ? settingsData.deposit_history_requires_manager : true,
          auto_delete_saved_carts_hours: parseInt(settingsData.auto_delete_saved_carts_hours) || 48,
          receipt_auto_print: settingsData.receipt_auto_print === true,
          receipt_auto_email: settingsData.receipt_auto_email || false,
          receipt_show_business_info: settingsData.receipt_show_business_info !== undefined ? settingsData.receipt_show_business_info : true,
          receipt_show_tax_details: settingsData.receipt_show_tax_details !== undefined ? settingsData.receipt_show_tax_details : true,
          receipt_paper_size: settingsData.receipt_paper_size || 'thermal_80mm',
          receipt_copies: parseInt(settingsData.receipt_copies) || 1,
          security_max_login_attempts: parseInt(settingsData.security_max_login_attempts) || 3,
          security_lockout_duration: parseInt(settingsData.security_lockout_duration) || 300,
          security_require_pin_for_voids: settingsData.security_require_pin_for_voids !== undefined ? settingsData.security_require_pin_for_voids : true,
          security_require_pin_for_discounts: settingsData.security_require_pin_for_discounts || false,
          security_audit_all_actions: settingsData.security_audit_all_actions !== undefined ? settingsData.security_audit_all_actions : true,
          alerts_low_stock_threshold: parseInt(settingsData.alerts_low_stock_threshold) || 10,
          alerts_enable_email_notifications: settingsData.alerts_enable_email_notifications !== undefined ? settingsData.alerts_enable_email_notifications : true,
          alerts_enable_push_notifications: settingsData.alerts_enable_push_notifications !== undefined ? settingsData.alerts_enable_push_notifications : true,
          alerts_cash_variance_alert: settingsData.alerts_cash_variance_alert !== undefined ? settingsData.alerts_cash_variance_alert : true,
          alerts_failed_payment_alert: settingsData.alerts_failed_payment_alert !== undefined ? settingsData.alerts_failed_payment_alert : true,
          indian_status_gst_rate: (() => {
            const r = parseFloat(settingsData.indian_status_gst_rate);
            return Number.isFinite(r) && r >= 0 ? r : 0.05;
          })(),
          indian_status_tax_label: (settingsData.indian_status_tax_label && String(settingsData.indian_status_tax_label).trim()) || 'GST (Indian Status)'
        });
      }
    } catch (err) {
      await logSecurityEvent('pos_settings_fetch_error', {
        error: err.message,
        business_id: auth.selectedBusinessId,
        terminal_id: currentTerminalId
      }, 'medium');
      
      setError('Error loading settings: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handle terminal changes
  const handleTerminalChange = async (terminalId) => {
    await logSecurityEvent('terminal_changed', {
      old_terminal: currentTerminalId,
      new_terminal: terminalId,
      business_id: auth.selectedBusinessId,
      changed_by: auth.authUser?.id
    }, 'low');

    setCurrentTerminalId(terminalId);
    
    if (terminalId) {
      localStorage.setItem('tavari_terminal_id', terminalId);
    } else {
      localStorage.removeItem('tavari_terminal_id');
      localStorage.removeItem('tavari_terminal_name');
    }
    
    fetchSettings();
  };

  // Save settings
  const handleSave = async () => {
    if (!canEditCurrentTab()) {
      setError('You do not have permission to edit these settings');
      await logSecurityEvent('pos_settings_save_denied', {
        tab: activeTab,
        business_id: auth.selectedBusinessId,
        user_id: auth.authUser?.id
      }, 'medium');
      return;
    }

    // Rate limiting
    const rateLimitCheck = await checkRateLimit('save_pos_settings', auth.authUser?.id);
    if (!rateLimitCheck.allowed) {
      setError('Too many save attempts. Please wait a moment.');
      return;
    }

    setError(null);
    setSaveSuccess(false);
    
    try {
      await logSecurityEvent('pos_settings_save_initiated', {
        tab: activeTab,
        business_id: auth.selectedBusinessId,
        terminal_id: currentTerminalId,
        saved_by: auth.authUser?.id
      }, 'medium');

      const updatedSettings = {
        terminal_mode: settings.terminal_mode,
        pin_required: settings.pin_required,
        tip_enabled: settings.tip_enabled,
        default_tip_percent: Number(settings.default_tip_percent),
        tax_rate: Number(settings.tax_rate),
        service_fee: Number(settings.service_fee),
        receipt_footer: settings.receipt_footer?.trim() || '',
        loyalty_mode: settings.loyalty_mode,
        auto_apply_loyalty: settings.auto_apply_loyalty,
        loyalty_min_redemption: Number(settings.loyalty_min_redemption),
        loyalty_manager_override_threshold: Number(settings.loyalty_manager_override_threshold),
        redemption_rate: Number(settings.redemption_rate),
        auto_lock_minutes: Number(settings.auto_lock_minutes),
        tab_enabled: settings.tab_enabled,
        max_tab_amount: Number(settings.max_tab_amount),
        require_customer_info_for_tabs: settings.require_customer_info_for_tabs,
        auto_close_tabs_after_hours: Number(settings.auto_close_tabs_after_hours),
        tab_number_prefix: settings.tab_number_prefix,
        tabs_enabled: settings.tabs_enabled,
        default_tab_limit: Number(settings.default_tab_limit),
        max_tab_limit: Number(settings.max_tab_limit),
        tab_limit_requires_manager: settings.tab_limit_requires_manager,
        tab_auto_close_hours: Number(settings.tab_auto_close_hours),
        tab_warning_threshold: Number(settings.tab_warning_threshold),
        lock_on_startup: settings.lock_on_startup,
        lock_after_sale: settings.lock_after_sale,
        cash_variance_threshold: Number(settings.cash_variance_threshold),
        default_float_amount: Number(settings.default_float_amount),
        max_drawer_variance: Number(settings.max_drawer_variance),
        require_manager_pin_for_variance: settings.require_manager_pin_for_variance,
        deposit_history_requires_manager: settings.deposit_history_requires_manager,
        auto_delete_saved_carts_hours: Number(settings.auto_delete_saved_carts_hours),
        receipt_auto_print: settings.receipt_auto_print,
        receipt_auto_email: settings.receipt_auto_email,
        receipt_show_business_info: settings.receipt_show_business_info,
        receipt_show_tax_details: settings.receipt_show_tax_details,
        receipt_paper_size: settings.receipt_paper_size,
        receipt_copies: Number(settings.receipt_copies),
        security_max_login_attempts: Number(settings.security_max_login_attempts),
        security_lockout_duration: Number(settings.security_lockout_duration),
        security_require_pin_for_voids: settings.security_require_pin_for_voids,
        security_require_pin_for_discounts: settings.security_require_pin_for_discounts,
        security_audit_all_actions: settings.security_audit_all_actions,
        alerts_low_stock_threshold: Number(settings.alerts_low_stock_threshold),
        alerts_enable_email_notifications: settings.alerts_enable_email_notifications,
        alerts_enable_push_notifications: settings.alerts_enable_push_notifications,
        alerts_cash_variance_alert: settings.alerts_cash_variance_alert,
        alerts_failed_payment_alert: settings.alerts_failed_payment_alert,
        indian_status_gst_rate: (() => {
          const r = Number(settings.indian_status_gst_rate);
          if (!Number.isFinite(r) || r < 0) return 0.05;
          return Math.min(1, r);
        })(),
        indian_status_tax_label: (settings.indian_status_tax_label || 'GST (Indian Status)').trim() || 'GST (Indian Status)',
      };

      const { data: savedSettings, error: saveError } = await savePosSettingsForTerminal(
        auth.selectedBusinessId,
        currentTerminalId || null,
        updatedSettings
      );

      if (saveError) throw saveError;

      await savePosSettingsForTerminal(
        auth.selectedBusinessId,
        null,
        pickDepositBusinessSettings(updatedSettings)
      );

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);

      await logSecurityEvent('pos_settings_saved', {
        tab: activeTab,
        business_id: auth.selectedBusinessId,
        terminal_id: currentTerminalId,
        saved_by: auth.authUser?.id,
        settings_count: Object.keys(updatedSettings).length
      }, 'low');

      await recordAction('pos_settings_updated', {
        tab: activeTab,
        terminal_id: currentTerminalId
      }, true);

    } catch (err) {
      await logSecurityEvent('pos_settings_save_error', {
        error: err.message,
        tab: activeTab,
        business_id: auth.selectedBusinessId
      }, 'high');
      
      setError('Error saving settings: ' + err.message);
    }
  };

  const handleInputChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }));
    setSaveSuccess(false);
  };

  // Tab configuration
  const tabs = [
    { id: 'general', label: 'General', icon: '⚙️', permission: canViewGeneralSettings },
    { id: 'payments', label: 'Payments', icon: '💳', permission: canViewPaymentSettings },
    { id: 'taxes', label: 'Taxes', icon: '📊', permission: canViewTaxSettings },
    { id: 'receipts', label: 'Receipts', icon: '🧾', permission: canViewReceiptSettings },
    { id: 'loyalty', label: 'Loyalty', icon: '🎯', permission: canViewLoyaltySettings },
    { id: 'tabs', label: 'Tabs', icon: '📋', permission: canViewTabSettings },
    { id: 'security', label: 'Security', icon: '🔒', permission: canViewSecuritySettings },
    { id: 'alerts', label: 'Alerts', icon: '🔔', permission: canViewAlertSettings }
  ].filter(tab => tab.permission); // Only show tabs user has permission for

  const renderTabContent = () => {
    if (!canViewCurrentTab()) {
      return (
        <div style={styles.noAccessContainer}>
          <h3 style={{ color: TavariStyles.colors.danger }}>Access Denied</h3>
          <p style={styles.noAccessText}>
            You do not have permission to view these settings.
          </p>
        </div>
      );
    }

    const commonProps = {
      settings,
      handleInputChange,
      businessId: auth.selectedBusinessId,
      currentTerminalId,
      onTerminalChange: handleTerminalChange,
      taxCategories,
      taxLoading,
      refreshTaxData,
      canEdit: canEditCurrentTab()
    };

    switch (activeTab) {
      case 'general':
        return <GeneralTab {...commonProps} />;
      case 'payments':
        return <PaymentsTab {...commonProps} />;
      case 'taxes':
        return <TaxesTab {...commonProps} />;
      case 'receipts':
        return <ReceiptsTab {...commonProps} />;
      case 'loyalty':
        return <LoyaltyTab {...commonProps} />;
      case 'tabs':
        return <TabsTab {...commonProps} />;
      case 'security':
        return <SecurityTab {...commonProps} />;
      case 'alerts':
        return <AlertsTab {...commonProps} />;
      default:
        return <GeneralTab {...commonProps} />;
    }
  };

  const styles = {
    container: {
      ...TavariStyles.layout.container
    },
    header: {
      marginBottom: TavariStyles.spacing['3xl'],
      textAlign: 'center',
      color: TavariStyles.colors.gray800
    },
    terminalIndicator: {
      marginTop: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.md,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    errorBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.xl
    },
    successBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.success,
      marginBottom: TavariStyles.spacing.xl
    },
    loadingSettings: {
      ...TavariStyles.components.loading.container
    },
    tabsContainer: {
      flex: 1,
      ...TavariStyles.layout.card,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    },
    tabsHeader: {
      display: 'flex',
      borderBottom: `2px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.gray50,
      overflowX: 'auto'
    },
    tab: {
      flex: 1,
      minWidth: '100px',
      padding: `${TavariStyles.spacing.lg} ${TavariStyles.spacing.xl}`,
      border: 'none',
      backgroundColor: 'transparent',
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray600,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.sm,
      transition: TavariStyles.transitions.normal,
      borderBottom: '3px solid transparent'
    },
    activeTab: {
      color: TavariStyles.colors.primary,
      borderBottomColor: TavariStyles.colors.primary,
      backgroundColor: TavariStyles.colors.white
    },
    tabIcon: {
      fontSize: TavariStyles.typography.fontSize.lg
    },
    tabsBody: {
      flex: 1,
      overflow: 'auto'
    },
    actions: {
      display: 'flex',
      gap: TavariStyles.spacing.lg,
      justifyContent: 'center',
      paddingTop: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      marginTop: TavariStyles.spacing.xl
    },
    saveButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.success
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

  // Check overall access
  if (!permissionsLoading && tabs.length === 0) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['owner', 'manager']}
          requireBusiness={true}
          componentName="POSSettings"
        >
          <div style={styles.container}>
            <div style={styles.noAccessContainer}>
              <h3 style={{ color: TavariStyles.colors.danger }}>Access Denied</h3>
              <p style={styles.noAccessText}>
                You do not have permission to view any POS settings.
              </p>
            </div>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['owner', 'manager']}
        requireBusiness={true}
        componentName="POSSettings"
      >
        <div style={styles.container}>
          <div style={styles.header}>
            <h2>POS Settings</h2>
            <p>Configure your point-of-sale system settings</p>
            {currentTerminalId && (
              <div style={styles.terminalIndicator}>
                Currently configuring: <strong>{terminalName || currentTerminalId}</strong>
              </div>
            )}
          </div>

          {error && <div style={styles.errorBanner}>{error}</div>}
          {saveSuccess && <div style={styles.successBanner}>Settings saved successfully!</div>}

          <div style={styles.tabsContainer}>
            <TavariTabSystemComponent
              tabs={tabs}
              mode="state"
              activeTab={activeTab}
              onTabChange={setActiveTab}
              ariaLabel="POS settings"
              variant="module"
              fullWidth={false}
              containerStyle={{ marginBottom: 0 }}
            />

            <div style={styles.tabsBody}>
              {loading || taxLoading || permissionsLoading ? (
                <div style={styles.loadingSettings}>Loading settings...</div>
              ) : (
                renderTabContent()
              )}
            </div>
          </div>

          <PermissionGate
            permissions={[`pos.settings.${activeTab}.edit`, 'pos.settings.edit']}
            requireAny={true}
            fallback={
              <div style={{ textAlign: 'center', padding: TavariStyles.spacing.lg }}>
                <p style={{ color: TavariStyles.colors.gray600 }}>
                  You have view-only access to these settings.
                </p>
              </div>
            }
          >
            <div style={styles.actions}>
              <button
                style={styles.saveButton}
                onClick={handleSave}
                disabled={loading || !canEditCurrentTab()}
              >
                {loading ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </PermissionGate>

          <ModuleDeactivationPanel moduleKey="pos" />
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default POSSettings;