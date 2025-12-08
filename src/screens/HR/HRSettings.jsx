// components/HR/HRSettings.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useNavigate } from 'react-router-dom';
import { SecurityWrapper } from '../../Security';
import { useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import POSAuthWrapper from "../../components/Auth/POSAuthWrapper";
import TavariCheckbox from "../../components/UI/TavariCheckbox";
import { TavariStyles } from '../../utils/TavariStyles';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';

// Import tab components
import EmployeeManagementTab from '../../components/HR/HRSettingsComponents/EmployeeManagementTab';
import LeaveAndBenefitsTab from '../../components/HR/HRSettingsComponents/LeaveAndBenefitsTab';
import ApprovalSettingsTab from '../../components/HR/HRSettingsComponents/ApprovalSettingsTab';
import NotificationSettingsTab from '../../components/HR/HRSettingsComponents/NotificationSettingsTab';
import DocumentManagementTab from '../../components/HR/HRSettingsComponents/DocumentManagementTab';
import ShiftPremiumsTab from '../../components/HR/HRSettingsComponents/ShiftPremiumsTab';

const HRSettings = () => {
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
    requiredRoles: ['owner', 'admin'],
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

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewHRSettings) {
      toast.error('You do not have permission to access HR Settings');
      navigate('/dashboard/hr/dashboard');
    }
  }, [permissionsLoading, canViewHRSettings]);

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

  const tabs = [
    {
      id: 'employee-management',
      label: 'Employee Management',
      icon: '👥',
      component: EmployeeManagementTab,
      permission: 'hr.settings.manage'
    },
    {
      id: 'leave-benefits',
      label: 'Leave & Benefits',
      icon: '🖊️',
      component: LeaveAndBenefitsTab,
      permission: 'hr.settings.manage'
    },
    {
      id: 'shift-premiums',
      label: 'Shift Premiums',
      icon: '💰',
      component: ShiftPremiumsTab,
      permission: 'hr.premiums.manage'
    },
    {
      id: 'approval-settings',
      label: 'Approvals',
      icon: '✅',
      component: ApprovalSettingsTab,
      permission: 'hr.settings.manage'
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: '🔔',
      component: NotificationSettingsTab,
      permission: 'hr.settings.manage'
    },
    {
      id: 'document-management',
      label: 'Documents',
      icon: '📄',
      component: DocumentManagementTab,
      permission: 'hr.documents.manage'
    }
  ];

  // Filter tabs based on permissions
  const visibleTabs = tabs.filter(tab => {
    if (!tab.permission) return true;
    return hasPermission(tab.permission) || isOwner();
  });

  useEffect(() => {
    if (selectedBusinessId && !authLoading && !permissionsLoading && canViewHRSettings) {
      loadSettings();
    }
  }, [selectedBusinessId, authLoading, permissionsLoading, canViewHRSettings]);

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

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      paddingTop: '60px',
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
    }
  };

  const renderActiveTab = () => {
    const activeTabConfig = visibleTabs.find(tab => tab.id === activeTab);
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
      <div style={styles.container}>
        <div style={styles.maxWidthContainer}>
          <div style={styles.accessDenied}>
            <h2 style={styles.accessDeniedTitle}>Access Denied</h2>
            <p>You do not have permission to access HR Settings</p>
            <button onClick={handleBackToDashboard} style={styles.backButton}>
              Return to HR Dashboard
            </button>
          </div>
        </div>
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
          {/* Add CSS for spinner animation */}
          <style>
            {`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}
          </style>

          <div style={styles.maxWidthContainer}>
            {/* Header */}
            <div style={styles.header}>
              <h1 style={styles.title}>HR Settings</h1>
              <p style={styles.subtitle}>
                {businessData?.business_name || businessData?.name || 'Configure HR settings for your business'}
              </p>
            </div>

            {/* Message */}
            {message && (
              <div style={{
                ...styles.messageContainer,
                ...(message.type === 'error' ? styles.errorMessage : {})
              }}>
                {message.text}
              </div>
            )}

            {/* Tabs Container */}
            <div style={styles.tabsContainer}>
              {/* Tabs Header */}
              <div style={styles.tabsHeader}>
                {visibleTabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{
                      ...styles.tab,
                      ...(activeTab === tab.id ? styles.activeTab : {})
                    }}
                  >
                    <span>{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div style={styles.tabContent}>
                {settings && renderActiveTab()}
              </div>

              {/* Save Button - Only show if user can manage settings */}
              {canManageHRSettings && (
                <div style={styles.saveButtonContainer}>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={styles.saveButton}
                  >
                    {saving ? 'Saving...' : 'Save Settings'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default HRSettings;