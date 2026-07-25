// components/HR/HRSettings.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { useNavigate } from 'react-router-dom';
import { SecurityWrapper } from '../../Security';
import { useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import POSAuthWrapper from "../../components/Auth/POSAuthWrapper";
import { TavariStyles } from '../../utils/TavariStyles';
import { usePermissions } from '../../hooks/usePermissions';
import toast from 'react-hot-toast';

// Import tab components
import EmployeeManagementTab from '../../components/HR/HRSettingsComponents/EmployeeManagementTab';
import LeaveAndBenefitsTab from '../../components/HR/HRSettingsComponents/LeaveAndBenefitsTab';
import ApprovalSettingsTab from '../../components/HR/HRSettingsComponents/ApprovalSettingsTab';
import NotificationSettingsTab from '../../components/HR/HRSettingsComponents/NotificationSettingsTab';
import ModuleDeactivationPanel from '../../components/Modules/ModuleDeactivationPanel';
import DocumentManagementTab from '../../components/HR/HRSettingsComponents/DocumentManagementTab';
import ShiftPremiumsTab from '../../components/HR/HRSettingsComponents/ShiftPremiumsTab';

const EMBED_SCOPES = {
  employee: ['employee-management', 'leave-benefits', 'shift-premiums'],
  communications: ['approval-settings', 'notifications', 'document-management'],
};

const ALL_SETTINGS_TABS = [
  {
    id: 'employee-management',
    label: 'Employee Management',
    icon: '👥',
    component: EmployeeManagementTab,
    permission: 'hr.settings.manage',
  },
  {
    id: 'leave-benefits',
    label: 'Leave & Benefits',
    icon: '🖊️',
    component: LeaveAndBenefitsTab,
    permission: 'hr.settings.manage',
  },
  {
    id: 'shift-premiums',
    label: 'Shift Premiums',
    icon: '💰',
    component: ShiftPremiumsTab,
    permission: 'hr.premiums.manage',
  },
  {
    id: 'approval-settings',
    label: 'Approvals',
    icon: '✅',
    component: ApprovalSettingsTab,
    permission: 'hr.settings.manage',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: '🔔',
    component: NotificationSettingsTab,
    permission: 'hr.settings.manage',
  },
  {
    id: 'document-management',
    label: 'Documents',
    icon: '📄',
    component: DocumentManagementTab,
    permission: 'hr.documents.manage',
  },
];

const HRSettings = (props) => {
  const {
    mode = 'standalone',
    embedScope = 'employee',
    activeSettingsTab = 'employee-management',
  } = props;
  const isEmbed = mode === 'embed';
  const embedTabIds = isEmbed && EMBED_SCOPES[embedScope] ? EMBED_SCOPES[embedScope] : null;

  const [activeTab, setActiveTab] = useState('employee-management');
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  // Security context for sensitive HR settings
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'HRSettings',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication context
  const {
    selectedBusinessId,
    authUser,
    userRole,
    businessData,
    authLoading,
    authError,
    isOwner
  } = usePOSAuth({
    requiredRoles: isEmbed ? ['owner', 'manager', 'admin', 'hr_admin'] : ['owner', 'admin'],
    requireBusiness: true,
    componentName: 'HRSettings'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Tax calculations for any needed tax logic
  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId);

  // Permission checks
  const canManageHRSettings = hasPermission('hr.settings.manage') || isOwner();
  const canViewHRSettings = hasPermission('hr.settings.view') || canManageHRSettings;

  // Check permissions on mount; embed mode leaves access handling to the parent
  useEffect(() => {
    if (isEmbed || permissionsLoading) return;
    if (!canViewHRSettings) {
      toast.error('You do not have permission to access HR Settings');
      navigate('/dashboard/hr/dashboard');
    }
  }, [permissionsLoading, canViewHRSettings, isEmbed, navigate]);

  const defaultSettings = {
    probation_period_days: 90,
    vacation_accrual_rate: 4.00,
    sick_leave_accrual_rate: 2.00,
    auto_generate_employee_numbers: true,
    employee_number_prefix: 'EMP',
    require_manager_approval_writeups: true,
    require_manager_approval_policy_changes: true,
    notification_email: '',
    notification_display_name: '',
    contract_expiry_warning_days: 30,
    policy_acknowledgment_deadline_days: 14,
    onboarding_completion_required: true,
    document_retention_years: 7,
    allow_employee_self_edit: true,
    require_manager_approval_profile_changes: false
  };

  // Filter tabs based on permissions (and embed scope)
  const visibleTabs = useMemo(() => {
    return ALL_SETTINGS_TABS.filter((tab) => (embedTabIds && isEmbed ? embedTabIds.includes(tab.id) : true))
      .filter((tab) => {
        if (!tab.permission) return true;
        return hasPermission(tab.permission) || isOwner();
      });
  }, [isEmbed, embedTabIds, hasPermission, isOwner, permissionsLoading]);

  const currentTab = useMemo(() => {
    if (isEmbed) {
      if (visibleTabs.find((t) => t.id === activeSettingsTab)) return activeSettingsTab;
      return visibleTabs[0]?.id || 'employee-management';
    }
    if (visibleTabs.length && !visibleTabs.find((t) => t.id === activeTab)) {
      return visibleTabs[0].id;
    }
    return activeTab;
  }, [isEmbed, activeSettingsTab, visibleTabs, activeTab]);

  useEffect(() => {
    if (selectedBusinessId && !authLoading && !permissionsLoading && canViewHRSettings) {
      loadSettings();
    }
  }, [selectedBusinessId, authLoading, permissionsLoading, canViewHRSettings]);

  // Standalone: if active tab became invisible (permissions), snap to first visible
  useEffect(() => {
    if (isEmbed) return;
    if (visibleTabs.length && !visibleTabs.find((t) => t.id === activeTab)) {
      setActiveTab(visibleTabs[0].id);
    }
  }, [isEmbed, visibleTabs, activeTab]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      
      await logSecurityEvent('settings_access', {
        action: 'load_hr_settings',
        business_id: selectedBusinessId
      }, 'medium');

      const { data: existingSettings, error: loadError } = await supabase
        .from('hr_settings')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .single();

      if (loadError && loadError.code !== 'PGRST116') {
        console.error('Error loading HR settings:', loadError);
        throw loadError;
      }

      if (existingSettings) {
        setSettings(existingSettings);
      } else {
        // Create default settings
        const newSettings = { ...defaultSettings, business_id: selectedBusinessId };
        
        const { data: createdSettings, error: createError } = await supabase
          .from('hr_settings')
          .insert([newSettings])
          .select()
          .single();

        if (createError) {
          console.error('Error creating default HR settings:', createError);
          setSettings(newSettings);
        } else {
          setSettings(createdSettings);
        }
      }

      recordAction('view_hr_settings', selectedBusinessId);
    } catch (error) {
      console.error('Error in loadSettings:', error);
      setError('Failed to load HR settings. Please try again.');
      setSettings({ ...defaultSettings, business_id: selectedBusinessId });
      
      await logSecurityEvent('settings_load_failed', {
        error_message: error.message,
        business_id: selectedBusinessId
      }, 'medium');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = async (field, value) => {
    if (!canManageHRSettings) {
      toast.error('You do not have permission to modify HR settings');
      return;
    }

    // Validate input for security
    const validation = await validateInput(value, 'text', field);

    if (!validation.valid) {
      setMessage({ 
        type: 'error', 
        text: `Invalid input for ${field}: ${validation.error}` 
      });
      toast.error(`Invalid input for ${field}`);
      return;
    }

    setSettings(prev => ({
      ...prev,
      [field]: value
    }));

    // Clear any existing messages
    setMessage(null);
  };

  const handleSave = async () => {
    if (!canManageHRSettings) {
      toast.error('You do not have permission to save HR settings');
      return;
    }

    try {
      setSaving(true);
      setMessage(null);

      // Rate limiting check
      const rateLimitCheck = await checkRateLimit('save_hr_settings', 10, 60);
      if (!rateLimitCheck) {
        setMessage({ 
          type: 'error', 
          text: 'Rate limit exceeded. Please wait before saving again.' 
        });
        toast.error('Too many save attempts. Please wait a moment.');
        return;
      }

      await logSecurityEvent('settings_modification', {
        action: 'save_hr_settings',
        business_id: selectedBusinessId,
        modified_by: authUser?.id
      }, 'high');

      // Prepare settings data for database
      const { id, created_at, updated_at, ...settingsToSave } = settings;

      // Update settings in database
      const { error: updateError } = await supabase
        .from('hr_settings')
        .update(settingsToSave)
        .eq('business_id', settings.business_id);

      if (updateError) {
        console.error('Error saving HR settings:', updateError);
        throw updateError;
      }

      await recordAction('hr_settings_updated', {
        business_id: selectedBusinessId,
        settings_fields: Object.keys(settingsToSave),
        user_role: userRole
      });

      setMessage({ type: 'success', text: 'HR settings saved successfully.' });
      toast.success('HR settings saved successfully');
      
      // Clear message after 3 seconds
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error('Error saving HR settings:', error);
      setMessage({ 
        type: 'error', 
        text: 'Failed to save settings. Please try again.' 
      });
      toast.error('Failed to save settings');

      await logSecurityEvent('settings_save_failed', {
        error_message: error.message,
        business_id: selectedBusinessId
      }, 'high');
    } finally {
      setSaving(false);
    }
  };

  const handleBackToDashboard = () => {
    navigate('/dashboard/hr/dashboard');
  };

  const setTab = (id) => {
    if (isEmbed) return;
    setActiveTab(id);
  };

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      paddingTop: '0px',
      paddingLeft: TavariStyles.spacing.lg,
      paddingRight: TavariStyles.spacing.lg,
      paddingBottom: TavariStyles.spacing.lg
    },
    maxWidthContainer: {
      maxWidth: '1200px',
      margin: '0 auto'
    },
    header: {
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['4xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: `0 0 ${TavariStyles.spacing.sm} 0`
    },
    subtitle: {
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.lg,
      margin: 0
    },
    messageContainer: {
      marginBottom: TavariStyles.spacing.xl,
      padding: TavariStyles.spacing.lg,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      borderLeft: '4px solid',
      borderLeftColor: TavariStyles.colors.success,
      backgroundColor: TavariStyles.colors.successBg,
      color: TavariStyles.colors.successText
    },
    errorMessage: {
      borderLeftColor: TavariStyles.colors.danger,
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.errorText
    },
    tabsContainer: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows?.base || '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
      overflow: 'hidden'
    },
    tabsHeader: {
      display: 'flex',
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.gray50,
      overflowX: 'auto'
    },
    tab: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      padding: `${TavariStyles.spacing.lg} ${TavariStyles.spacing.xl}`,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray600,
      backgroundColor: 'transparent',
      border: 'none',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      whiteSpace: 'nowrap',
      minWidth: 'fit-content'
    },
    activeTab: {
      color: TavariStyles.colors.primary,
      backgroundColor: TavariStyles.colors.white,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`,
      marginBottom: '-1px'
    },
    tabContent: {
      padding: TavariStyles.spacing.xl
    },
    saveButtonContainer: {
      display: 'flex',
      justifyContent: 'flex-end',
      marginTop: TavariStyles.spacing.xl,
      paddingTop: TavariStyles.spacing.lg,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`
    },
    saveButton: {
      ...TavariStyles.components.button?.base || {
        padding: '12px 24px',
        borderRadius: TavariStyles.borderRadius?.md || '8px',
        border: 'none',
        fontSize: TavariStyles.typography.fontSize.base,
        fontWeight: TavariStyles.typography.fontWeight.semibold,
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      },
      backgroundColor: saving ? TavariStyles.colors.gray400 : TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      cursor: saving ? 'not-allowed' : 'pointer',
      opacity: !canManageHRSettings ? 0.5 : 1
    },
    loadingContainer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '50vh'
    },
    loadingContent: {
      textAlign: 'center'
    },
    spinner: {
      width: '32px',
      height: '32px',
      border: `3px solid ${TavariStyles.colors.primary}`,
      borderTop: '3px solid transparent',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      margin: '0 auto 8px auto'
    },
    loadingText: {
      margin: 0,
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    accessDenied: {
      textAlign: 'center',
      padding: '60px 20px',
      color: TavariStyles.colors.gray600
    },
    accessDeniedTitle: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },
    backButton: {
      ...TavariStyles.components.button?.base,
      ...TavariStyles.components.button?.variants?.secondary,
      marginTop: TavariStyles.spacing.xl
    },
    embedWrap: {
      width: '100%',
    },
    embedAccessDenied: {
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.lg,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
    },
    embedEmpty: {
      padding: TavariStyles.spacing.xl,
      textAlign: 'center',
      color: TavariStyles.colors.gray600,
    },
    noTabsText: {
      margin: 0,
      fontSize: TavariStyles.typography.fontSize.base,
    }
  };

  const renderActiveTab = () => {
    const activeTabConfig = visibleTabs.find((tab) => tab.id === currentTab);
    if (!activeTabConfig) return null;

    const TabComponent = activeTabConfig.component;
    
    return (
      <TabComponent
        settings={settings}
        onSettingsChange={handleInputChange}
        selectedBusinessId={selectedBusinessId}
        businessData={businessData}
        userRole={userRole}
        authUser={authUser}
        saving={saving}
        formatTaxAmount={formatTaxAmount}
        canEdit={canManageHRSettings}
      />
    );
  };

  // Loading states
  if (permissionsLoading || authLoading || loading) {
    return (
      <div style={styles.container}>
        <style>
          {`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}
        </style>
        <div style={styles.loadingContainer}>
          <div style={styles.loadingContent}>
            <div style={styles.spinner}></div>
            <p style={styles.loadingText}>Loading HR Settings...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!canViewHRSettings) {
    return (
      <div style={isEmbed ? styles.embedAccessDenied : styles.container}>
        <div style={styles.maxWidthContainer}>
          <div style={styles.accessDenied}>
            <h2 style={styles.accessDeniedTitle}>Access Denied</h2>
            <p>You do not have permission to access HR settings for this business.</p>
            <button onClick={handleBackToDashboard} type="button" style={styles.backButton}>
              Return to HR overview
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isEmbed && !visibleTabs.length) {
    return (
      <div style={styles.embedEmpty}>
        <p style={styles.noTabsText}>
          You do not have access to any of the settings in this section.
        </p>
      </div>
    );
  }

  const messageBlock = message && (
    <div
      style={{
        ...styles.messageContainer,
        ...(message.type === 'error' ? styles.errorMessage : {}),
      }}
    >
      {message.text}
    </div>
  );

  const mainSettingsBody = (
    <>
      {messageBlock}
      <div style={styles.tabsContainer}>
        {!isEmbed && (
          <div style={styles.tabsHeader}>
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTab(tab.id)}
                style={{
                  ...styles.tab,
                  ...(currentTab === tab.id ? styles.activeTab : {}),
                }}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        )}

        <div style={styles.tabContent}>
          {settings && renderActiveTab()}
        </div>

        {canManageHRSettings && (
          <div style={styles.saveButtonContainer}>
            <button
              onClick={handleSave}
              disabled={saving}
              type="button"
              style={styles.saveButton}
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        )}
      </div>
    </>
  );

  if (isEmbed) {
    return (
      <div style={styles.embedWrap}>
        <style>
          {`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}
        </style>
        {mainSettingsBody}
      </div>
    );
  }

  return (
    <POSAuthWrapper
      componentName="HRSettings"
      requiredRoles={['owner', 'admin']}
      requireBusiness={true}
    >
      <SecurityWrapper
        componentName="HRSettings"
        securityLevel="high"
        enableAuditLogging={true}
        sensitiveComponent={true}
      >
        <div style={styles.container}>
          <style>
            {`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}
          </style>
          <div style={styles.maxWidthContainer}>
            <div style={styles.header}>
              <h1 style={styles.title}>HR Settings</h1>
              <p style={styles.subtitle}>
                {businessData?.business_name || businessData?.name || 'Configure HR settings for your business'}
              </p>
            </div>
            {mainSettingsBody}
            <ModuleDeactivationPanel moduleKey="hr" />
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default HRSettings;