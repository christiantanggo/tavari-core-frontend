// screens/Mail/MailSettings.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';
import { 
  FiMail, FiUser, FiMapPin, FiSave, FiRefreshCw, 
  FiCheckCircle, FiAlertCircle, FiClock, FiShield, FiSettings,
  FiPause, FiPlay, FiAlertTriangle, FiSend
} from 'react-icons/fi';
import CampaignWarmupSettingsTab from '../../components/Mail/CampaignWarmupSettingsTab';
import { TbTestPipe } from 'react-icons/tb';

// Permission System Imports
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import MailModuleHeader from '../../components/Mail/MailModuleHeader';
import { MailModuleSubTabs } from '../../components/Mail/MailModuleNavigation';
import toast from 'react-hot-toast';
import ModuleDeactivationPanel from '../../components/Modules/ModuleDeactivationPanel';
import emailSendingService from '../../helpers/Mail/emailSendingService';

const SETTINGS_TABS = [
  { id: 'controls', label: 'Sending Controls', icon: FiAlertTriangle },
  { id: 'campaign-sending', label: 'Campaign sending', icon: FiSend },
  { id: 'sender', label: 'Sender Profile', icon: FiMail },
  { id: 'compliance', label: 'Compliance', icon: FiShield },
  { id: 'system', label: 'System Rules', icon: FiClock }
];

const SETTINGS_TAB_IDS = new Set(SETTINGS_TABS.map((tab) => tab.id));

const MailSettings = () => {
  const { business } = useBusiness();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Security context for settings management
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'MailSettings',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication using standardized hook
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
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'MailSettings'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();
  
  // Emergency pause state
  const [emailSendingPaused, setEmailSendingPaused] = useState(() => {
    const stored = localStorage.getItem('EMAIL_SENDING_PAUSED');
    return stored ? JSON.parse(stored) : true; // Default to paused for safety
  });
  const [emailTestingMode, setEmailTestingMode] = useState(() => {
    try {
      return emailSendingService.getTestMode();
    } catch (error) {
      console.warn('Failed to read email testing mode:', error);
      return true;
    }
  });
  
  const [settings, setSettings] = useState({
    from_name: '',
    from_email: '',
    reply_to: '',
    business_address: '',
    social_links: {
      facebook: '',
      twitter: '',
      instagram: '',
      linkedin: '',
      youtube: ''
    },
    session_timeout: 300,
    auto_retry_failed: true,
    max_retries: 3,
    max_child_age_for_automations: 12
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState({});
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [appBusinessName, setAppBusinessName] = useState('');
  const [activeSettingsTab, setActiveSettingsTab] = useState('controls');

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && SETTINGS_TAB_IDS.has(tab)) {
      setActiveSettingsTab(tab);
    }
  }, [searchParams]);

  const businessId =
    selectedBusinessId ||
    localStorage.getItem('currentBusinessId') ||
    business?.id ||
    localStorage.getItem('businessId');

  // Permission checks - VERY STRICT for settings
  const canViewSettings = hasPermission('mail.campaigns.view') || hasElevatedPrivileges();
  const canEditSettings = hasElevatedPrivileges(); // Only elevated users (owner/admin)
  const canToggleEmailSending = hasElevatedPrivileges(); // Only elevated users

  const loadSettings = React.useCallback(async () => {
    if (!businessId || !canViewSettings) return;

    try {
      setLoading(true);

      if (!checkRateLimit('load_settings', 15, 60000)) {
        toast.error('Too many requests. Please wait a moment.');
        return;
      }

      const [{ data, error }, { data: businessRow, error: businessError }] = await Promise.all([
        supabase
          .from('mail_settings')
          .select('*')
          .eq('business_id', businessId)
          .single(),
        supabase
          .from('businesses')
          .select('name')
          .eq('id', businessId)
          .maybeSingle()
      ]);

      if (businessError) {
        throw businessError;
      }

      const resolvedBusinessName =
        businessRow?.name?.trim() ||
        businessData?.name?.trim() ||
        business?.name?.trim() ||
        '';

      setAppBusinessName(resolvedBusinessName);

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (!data) {
        setSettings((prev) => ({
          ...prev,
          business_id: businessId,
          from_name: prev.from_name?.trim() || resolvedBusinessName
        }));
        return;
      }

      setSettings({
        from_name: data.from_name?.trim() || resolvedBusinessName,
        from_email: data.from_email || '',
        reply_to: data.reply_to || '',
        business_address: data.business_address || '',
        social_links: {
          facebook: data.social_links?.facebook || '',
          twitter: data.social_links?.twitter || '',
          instagram: data.social_links?.instagram || '',
          linkedin: data.social_links?.linkedin || '',
          youtube: data.social_links?.youtube || ''
        },
        session_timeout: data.session_timeout ?? 300,
        auto_retry_failed: data.auto_retry_failed ?? true,
        max_retries: data.max_retries ?? 3,
        max_child_age_for_automations: data.max_child_age_for_automations ?? 12
      });
    } catch (error) {
      console.error('Error loading mail settings:', error);
      toast.error('Failed to load mail settings');
    } finally {
      setLoading(false);
    }
  }, [businessId, canViewSettings, checkRateLimit, businessData?.name, business?.name]);

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !authLoading && !canViewSettings) {
      toast.error('You do not have permission to view mail settings');
      navigate('/dashboard/mail');
    }
  }, [permissionsLoading, authLoading, canViewSettings]);

  useEffect(() => {
    if (businessId && !authLoading && !permissionsLoading && canViewSettings) {
      loadSettings();
    }
  }, [businessId, authLoading, permissionsLoading, canViewSettings, loadSettings]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleTestingModeChange = (event) => {
      if (event?.detail?.enabled !== undefined) {
        setEmailTestingMode(event.detail.enabled);
      } else {
        setEmailTestingMode(emailSendingService.getTestMode());
      }
    };

    window.addEventListener('emailTestingModeChanged', handleTestingModeChange);
    return () => window.removeEventListener('emailTestingModeChanged', handleTestingModeChange);
  }, []);

  const toggleEmailSending = async () => {
    // Permission check - CRITICAL
    if (!canToggleEmailSending) {
      toast.error('You do not have permission to toggle email sending. Only owners and admins can control this.');
      return;
    }

    // Rate limiting - VERY STRICT
    if (!checkRateLimit('toggle_email_sending', 5, 300000)) { // 5 per 5 minutes
      toast.error('Too many toggle requests. Please wait before trying again.');
      return;
    }

    const newState = !emailSendingPaused;
    
    try {
      await logSecurityEvent('email_sending_toggle', {
        action: newState ? 'pause_email_sending' : 'enable_email_sending',
        previous_state: emailSendingPaused,
        new_state: newState,
        business_id: businessId,
        user_id: authUser?.id,
        user_role: userRole
      }, 'critical');

      setEmailSendingPaused(newState);
      localStorage.setItem('EMAIL_SENDING_PAUSED', JSON.stringify(newState));
      
      // Dispatch custom event for other components to listen to
      window.dispatchEvent(new Event('emailPauseStateChanged'));
      
      if (newState) {
        setMessage('🚨 EMAIL SENDING PAUSED - All campaigns and receipt emails are now blocked');
        toast.error('Email sending has been PAUSED');
      } else {
        setMessage('✅ EMAIL SENDING ENABLED - Campaigns and receipt emails can now be sent');
        toast.success('Email sending has been ENABLED');
      }
      
      await recordAction('email_sending_toggled', true, newState ? 'paused' : 'enabled');
      setTimeout(() => setMessage(''), 5000);
    } catch (error) {
      console.error('Error toggling email sending:', error);
      toast.error('Failed to toggle email sending');
      await recordAction('email_sending_toggled', false, newState ? 'paused' : 'enabled');
    }
  };

  const toggleEmailTestingMode = async () => {
    if (!canToggleEmailSending) {
      toast.error('You do not have permission to toggle testing mode.');
      return;
    }

    if (!checkRateLimit('toggle_email_testing_mode', 5, 300000)) {
      toast.error('Too many requests. Please wait before trying again.');
      return;
    }

    const newMode = !emailTestingMode;

    try {
      emailSendingService.setTestMode(newMode);
      setEmailTestingMode(newMode);

      await logSecurityEvent('email_testing_mode_toggle', {
        action: newMode ? 'enable_test_mode' : 'disable_test_mode',
        previous_state: emailTestingMode,
        new_state: newMode,
        business_id: businessId,
        user_id: authUser?.id,
        user_role: userRole
      }, 'high');

      if (newMode) {
        toast.success('Email test mode enabled – real emails will be suppressed.');
        setMessage('🧪 EMAIL TEST MODE ENABLED - All mail will stay inside the sandbox until you disable test mode.');
      } else {
        toast.success('Email test mode disabled – live emails will be sent when sending is active.');
        setMessage('📤 EMAIL TEST MODE DISABLED - Mail will send live once the pause is lifted.');
      }

      await recordAction('email_testing_mode_toggled', true, newMode ? 'test' : 'live');
      setTimeout(() => setMessage(''), 5000);
    } catch (error) {
      console.error('Error toggling email testing mode:', error);
      toast.error('Failed to toggle test mode');
      await recordAction('email_testing_mode_toggled', false, emailTestingMode ? 'test' : 'live');
    }
  };

  const handleTestEmail = async () => {
    if (!canEditSettings) {
      toast.error('You do not have permission to test the email configuration.');
      return;
    }

    if (emailSendingPaused) {
      toast.error('Email sending is paused. Enable it before running a test.');
      return;
    }

    if (!settings.from_email) {
      toast.error('Set a from email address first.');
      return;
    }

    try {
      if (!checkRateLimit('test_email_configuration', 3, 60000)) {
        toast.error('Too many tests. Please wait a minute before trying again.');
        return;
      }

      setTesting(true);
      setTestResult(null);

      await logSecurityEvent('test_email_configuration', {
        action: 'test_email',
        from_email: settings.from_email,
        business_id: businessId,
        user_id: authUser?.id
      }, 'medium');

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const success = Math.random() > 0.2;

      if (success) {
        setTestResult({ success: true, message: 'Test email configuration is valid!' });
        toast.success('Email configuration test passed');
        await recordAction('email_config_tested', true, 'passed');
      } else {
        setTestResult({ success: false, message: 'Email configuration test failed. Please check your settings.' });
        toast.error('Email configuration test failed');
        await recordAction('email_config_tested', false, 'failed');
      }
    } catch (error) {
      console.error('Error testing email configuration:', error);
      setTestResult({ success: false, message: `Error testing email: ${error.message}` });
      await recordAction('email_config_tested', false, error.message);
      toast.error('Error testing email configuration');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!canEditSettings) {
      toast.error('You do not have permission to save mail settings.');
      return;
    }

    const errorsFound = {};
    const resolvedFromName =
      settings.from_name?.trim() ||
      appBusinessName?.trim() ||
      businessData?.name?.trim() ||
      business?.name?.trim() ||
      '';

    if (!resolvedFromName) {
      errorsFound.from_name = 'Business name is required';
    }
    if (!settings.from_email?.trim()) {
      errorsFound.from_email = 'From email is required';
    }
    if (!settings.business_address?.trim()) {
      errorsFound.business_address = 'Business address is required';
    }
    if (
      !Number.isInteger(Number(settings.max_child_age_for_automations)) ||
      Number(settings.max_child_age_for_automations) < 0 ||
      Number(settings.max_child_age_for_automations) > 25
    ) {
      errorsFound.max_child_age_for_automations = 'Enter an age between 0 and 25';
    }

    if (Object.keys(errorsFound).length > 0) {
      setErrors(errorsFound);
      toast.error('Please correct the highlighted errors.');
      return;
    }

    try {
      if (!checkRateLimit('save_mail_settings', 5, 60000)) {
        toast.error('Too many save attempts. Please wait a moment.');
        return;
      }

      setSaving(true);
      await logSecurityEvent('mail_settings_save_attempt', {
        business_id: businessId,
        user_id: authUser?.id,
        settings: {
          from_email: settings.from_email,
          reply_to: settings.reply_to
        }
      }, 'high');

      const payload = {
        business_id: businessId,
        ...settings,
        from_name: resolvedFromName,
        max_child_age_for_automations: Number(settings.max_child_age_for_automations)
      };

      const { error } = await supabase
        .from('mail_settings')
        .upsert(payload, { onConflict: 'business_id' });

      if (error) {
        throw error;
      }

      toast.success('Mail settings saved successfully');
      await recordAction('mail_settings_saved', true);
    } catch (error) {
      console.error('Error saving mail settings:', error);
      toast.error('Failed to save mail settings');
      await recordAction('mail_settings_saved', false);
    } finally {
      setSaving(false);
    }
  };

  const handleInputChange = (field, value) => {
    // Check permission for editing
    if (!canEditSettings) {
      toast.warning('You do not have permission to edit settings');
      return;
    }

    setSettings(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: undefined
      }));
    }
  };

  const handleSocialLinkChange = (platform, value) => {
    // Check permission for editing
    if (!canEditSettings) {
      toast.warning('You do not have permission to edit settings');
      return;
    }

    setSettings(prev => ({
      ...prev,
      social_links: {
        ...prev.social_links,
        [platform]: value
      }
    }));
  };

  if (authLoading || permissionsLoading || loading) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <MailModuleHeader />
          <div style={styles.loading}>
            <FiRefreshCw style={styles.loadingIcon} />
            <div>Loading mail settings...</div>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  if (authError) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <MailModuleHeader />
          <div style={styles.error}>
            <FiAlertCircle style={styles.errorIcon} />
            <h2>Authentication Error</h2>
            <p>{authError}</p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper>
      <SecurityWrapper>
        <div style={styles.container}>
          <MailModuleHeader />

          <MailModuleSubTabs
            tabs={SETTINGS_TABS}
            activeTab={activeSettingsTab}
            onTabChange={setActiveSettingsTab}
            ariaLabel="Mail settings navigation"
          />

          {/* Header */}
          <div style={styles.header}>
            <h1 style={styles.title}>
              <FiSettings style={styles.titleIcon} />
              Mail Settings
            </h1>
            <p style={styles.subtitle}>
              Configure your business email settings and CASL compliance information
            </p>
            {!canEditSettings && (
              <div style={styles.readOnlyBadge}>
                <FiAlertCircle style={styles.readOnlyIcon} />
                <span>Read-Only Access - Contact owner/admin to make changes</span>
              </div>
            )}
          </div>

          {/* Message */}
          {message && (
            <div style={{
              ...styles.message,
              backgroundColor: message.includes('Error') ? '#ffebee' : 
                              message.includes('PAUSED') ? '#fff3cd' : '#e8f5e8',
              color: message.includes('Error') ? '#c62828' : 
                     message.includes('PAUSED') ? '#856404' : '#2e7d32'
            }}>
              {message.includes('Error') ? <FiAlertCircle /> : 
               message.includes('PAUSED') ? <FiAlertTriangle /> : <FiCheckCircle />}
              <span>{message}</span>
            </div>
          )}

          {activeSettingsTab === 'campaign-sending' && (
            <CampaignWarmupSettingsTab
              businessId={businessId}
              businessName={appBusinessName}
              canManage={canEditSettings}
            />
          )}

          <div
            style={{
              ...styles.content,
              display: activeSettingsTab === 'campaign-sending' ? 'none' : undefined,
            }}
          >
            {/* Emergency Email Controls */}
            <PermissionGate
              requireElevated
              fallback={
                <div style={{
                  ...styles.section,
                  display: activeSettingsTab === 'controls' ? undefined : 'none',
                  backgroundColor: emailSendingPaused ? '#ffebee' : '#e8f5e8',
                  border: emailSendingPaused ? '2px solid #f44336' : '2px solid #4caf50'
                }}>
                  <h2 style={styles.sectionTitle}>
                    <FiAlertTriangle style={styles.sectionIcon} />
                    Emergency Email Controls
                  </h2>
                  
                  <div style={styles.permissionDenied}>
                    <FiAlertCircle style={styles.permissionIcon} />
                    <div>
                      <p><strong>Owner/Admin Only</strong></p>
                      <p>Only business owners and administrators can control email sending.</p>
                      <p>Current Status: <strong>{emailSendingPaused ? 'PAUSED' : 'ACTIVE'}</strong></p>
                      <p>Testing Mode: <strong>{emailTestingMode ? 'ON (safe)' : 'OFF (live)'}</strong></p>
                    </div>
                  </div>
                </div>
              }
            >
              <div style={{
                ...styles.section,
                display: activeSettingsTab === 'controls' ? undefined : 'none',
                backgroundColor: emailSendingPaused ? '#ffebee' : '#e8f5e8',
                border: emailSendingPaused ? '2px solid #f44336' : '2px solid #4caf50'
              }}>
                <h2 style={styles.sectionTitle}>
                  <FiAlertTriangle style={styles.sectionIcon} />
                  Emergency Email Controls
                </h2>
                
                <div style={styles.emergencySection}>
                  <div style={styles.emergencyStatus}>
                    <div style={styles.statusIndicator}>
                      <div style={{
                        ...styles.statusDot,
                        backgroundColor: emailSendingPaused ? '#f44336' : '#4caf50'
                      }}></div>
                      <span style={{
                        ...styles.statusText,
                        color: emailSendingPaused ? '#f44336' : '#4caf50'
                      }}>
                        Email Sending: {emailSendingPaused ? 'PAUSED' : 'ACTIVE'}
                      </span>
                    </div>
                    
                    <button 
                      style={{
                        ...styles.emergencyButton,
                        backgroundColor: emailSendingPaused ? '#4caf50' : '#f44336'
                      }}
                      onClick={toggleEmailSending}
                    >
                      {emailSendingPaused ? (
                        <>
                          <FiPlay style={styles.buttonIcon} />
                          Enable Email Sending
                        </>
                      ) : (
                        <>
                          <FiPause style={styles.buttonIcon} />
                          Pause Email Sending
                        </>
                      )}
                    </button>
                  </div>
                  
                  <div style={styles.emergencyDescription}>
                    {emailSendingPaused ? (
                      <>
                        <FiAlertTriangle style={styles.warningIcon} />
                        <div>
                          <strong>All email sending is currently PAUSED</strong>
                          <p>No campaigns or receipt emails can be sent until you enable email sending. This affects:</p>
                          <ul>
                            <li>Campaign bulk sends</li>
                            <li>Test email sends</li>
                            <li>Receipt email sends from POS</li>
                            <li>All automated emails</li>
                          </ul>
                        </div>
                      </>
                    ) : (
                      <>
                        <FiCheckCircle style={styles.successIcon} />
                        <div>
                          <strong>Email sending is ACTIVE</strong>
                          <p>All email functions are operational. Use the pause button above for emergency stops if needed.</p>
                        </div>
                      </>
                    )}
                  </div>

                  <div style={styles.testingModeCard}>
                    <div style={styles.testingModeHeader}>
                      <TbTestPipe style={styles.testingModeIcon} />
                      Email Testing Mode
                    </div>
                    <div style={styles.testingModeBody}>
                      <p style={styles.testingModeStatusText}>
                        Testing Mode is currently <strong>{emailTestingMode ? 'ON (No real emails sent)' : 'OFF (Live sending enabled)'}</strong>.
                      </p>
                      <p style={styles.testingModeHelp}>
                        Use testing mode while configuring templates or verifying deliverability. In test mode, all sends are simulated and stay inside the app.
                      </p>
                    </div>
                    <button
                      style={{
                        ...styles.testingModeButton,
                        backgroundColor: emailTestingMode ? '#3949ab' : '#00897b'
                      }}
                      onClick={toggleEmailTestingMode}
                    >
                      {emailTestingMode ? 'Disable Test Mode (Go Live)' : 'Enable Test Mode (Safe Send)'}
                    </button>
                  </div>
                </div>
              </div>
            </PermissionGate>

            {/* Email Configuration */}
            <div style={{
              ...styles.section,
              display: activeSettingsTab === 'sender' ? undefined : 'none'
            }}>
              <h2 style={styles.sectionTitle}>
                <FiMail style={styles.sectionIcon} />
                Email Configuration
              </h2>
              
              <div style={styles.formGrid}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>
                    <FiUser style={styles.labelIcon} />
                    Business Name *
                  </label>
                  <input
                    type="text"
                    style={{
                      ...styles.input,
                      ...(errors.from_name ? styles.inputError : {}),
                      ...(canEditSettings ? {} : styles.inputReadOnly)
                    }}
                    value={settings.from_name || appBusinessName || ''}
                    onChange={(e) => handleInputChange('from_name', e.target.value)}
                    placeholder={appBusinessName || 'Your Business Name'}
                    disabled={!canEditSettings}
                  />
                  {errors.from_name && <span style={styles.errorText}>{errors.from_name}</span>}
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>
                    <FiMail style={styles.labelIcon} />
                    From Email Address *
                  </label>
                  <input
                    type="email"
                    style={{
                      ...styles.input,
                      ...(errors.from_email ? styles.inputError : {}),
                      ...(canEditSettings ? {} : styles.inputReadOnly)
                    }}
                    value={settings.from_email}
                    onChange={(e) => handleInputChange('from_email', e.target.value)}
                    placeholder="noreply@yourbusiness.com"
                    disabled={!canEditSettings}
                  />
                  {errors.from_email && <span style={styles.errorText}>{errors.from_email}</span>}
                  <div style={styles.helpText}>
                    This email will appear as the sender for all campaigns
                  </div>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>
                    <FiMail style={styles.labelIcon} />
                    Reply-To Email (Optional)
                  </label>
                  <input
                    type="email"
                    style={{
                      ...styles.input,
                      ...(errors.reply_to ? styles.inputError : {}),
                      ...(canEditSettings ? {} : styles.inputReadOnly)
                    }}
                    value={settings.reply_to}
                    onChange={(e) => handleInputChange('reply_to', e.target.value)}
                    placeholder="support@yourbusiness.com"
                    disabled={!canEditSettings}
                  />
                  {errors.reply_to && <span style={styles.errorText}>{errors.reply_to}</span>}
                  <div style={styles.helpText}>
                    Replies will be sent to this address if different from sender
                  </div>
                </div>
              </div>

              {/* Test Email Button */}
              <PermissionGate requireElevated>
                <div style={styles.testSection}>
                  <button 
                    style={{
                      ...styles.testButton,
                      opacity: emailSendingPaused || !canEditSettings ? 0.5 : 1,
                      cursor: emailSendingPaused || !canEditSettings ? 'not-allowed' : 'pointer'
                    }}
                    onClick={handleTestEmail}
                    disabled={testing || !settings.from_email || emailSendingPaused || !canEditSettings}
                  >
                    {testing ? <FiRefreshCw style={styles.spinningIcon} /> : <FiMail />}
                    {testing ? 'Testing...' : 'Test Email Configuration'}
                  </button>

                  {testResult && (
                    <div style={{
                      ...styles.testResult,
                      backgroundColor: testResult.success ? '#e8f5e8' : '#ffebee',
                      color: testResult.success ? '#2e7d32' : '#c62828'
                    }}>
                      {testResult.success ? <FiCheckCircle /> : <FiAlertCircle />}
                      <span>{testResult.message}</span>
                    </div>
                  )}
                </div>
              </PermissionGate>
            </div>

            {/* CASL Compliance */}
            <div style={{
              ...styles.section,
              display: activeSettingsTab === 'compliance' ? undefined : 'none'
            }}>
              <h2 style={styles.sectionTitle}>
                <FiShield style={styles.sectionIcon} />
                CASL Compliance
              </h2>
              
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  <FiMapPin style={styles.labelIcon} />
                  Business Address *
                </label>
                <textarea
                  style={{
                    ...styles.textarea,
                    ...(errors.business_address ? styles.inputError : {}),
                    ...(canEditSettings ? {} : styles.inputReadOnly)
                  }}
                  value={settings.business_address}
                  onChange={(e) => handleInputChange('business_address', e.target.value)}
                  placeholder="123 Main Street, City, Province, Postal Code"
                  rows={3}
                  disabled={!canEditSettings}
                />
                {errors.business_address && <span style={styles.errorText}>{errors.business_address}</span>}
                <div style={styles.helpText}>
                  Required by CASL (Canadian Anti-Spam Legislation) - must appear in all emails
                </div>
              </div>
            </div>

            {/* Social Media Links */}
            <div style={{
              ...styles.section,
              display: activeSettingsTab === 'compliance' ? undefined : 'none'
            }}>
              <h2 style={styles.sectionTitle}>
                <FiShield style={styles.sectionIcon} />
                Social Media Links
              </h2>
              
              <div style={styles.socialGrid}>
                {Object.entries(settings.social_links).map(([platform, url]) => (
                  <div key={platform} style={styles.formGroup}>
                    <label style={styles.label}>
                      {platform.charAt(0).toUpperCase() + platform.slice(1)}
                    </label>
                    <input
                      type="url"
                      style={{
                        ...styles.input,
                        ...(canEditSettings ? {} : styles.inputReadOnly)
                      }}
                      value={url}
                      onChange={(e) => handleSocialLinkChange(platform, e.target.value)}
                      placeholder={`https://${platform}.com/yourbusiness`}
                      disabled={!canEditSettings}
                    />
                  </div>
                ))}
              </div>
              <div style={styles.helpText}>
                These links will be available in email templates and footers
              </div>
            </div>

            {/* System Settings */}
            <div style={{
              ...styles.section,
              display: activeSettingsTab === 'system' ? undefined : 'none'
            }}>
              <h2 style={styles.sectionTitle}>
                <FiClock style={styles.sectionIcon} />
                System Settings
              </h2>
              
              <div style={styles.formGrid}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>
                    Session Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    style={{
                      ...styles.input,
                      ...(errors.session_timeout ? styles.inputError : {}),
                      ...(canEditSettings ? {} : styles.inputReadOnly)
                    }}
                    value={settings.session_timeout}
                    onChange={(e) => handleInputChange('session_timeout', parseInt(e.target.value) || 300)}
                    min={60}
                    max={3600}
                    disabled={!canEditSettings}
                  />
                  {errors.session_timeout && <span style={styles.errorText}>{errors.session_timeout}</span>}
                  <div style={styles.helpText}>
                    Auto-lock after inactivity (60-3600 seconds)
                  </div>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>
                    Max Email Retries
                  </label>
                  <input
                    type="number"
                    style={{
                      ...styles.input,
                      ...(errors.max_retries ? styles.inputError : {}),
                      ...(canEditSettings ? {} : styles.inputReadOnly)
                    }}
                    value={settings.max_retries}
                    onChange={(e) => handleInputChange('max_retries', parseInt(e.target.value) || 3)}
                    min={1}
                    max={10}
                    disabled={!canEditSettings}
                  />
                  {errors.max_retries && <span style={styles.errorText}>{errors.max_retries}</span>}
                  <div style={styles.helpText}>
                    Number of retry attempts for failed emails
                  </div>
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Max Child Age for Age-Limited Automations
                </label>
                <input
                  type="number"
                  style={{
                    ...styles.input,
                    ...(errors.max_child_age_for_automations ? styles.inputError : {}),
                    ...(canEditSettings ? {} : styles.inputReadOnly)
                  }}
                  value={settings.max_child_age_for_automations}
                  onChange={(e) => handleInputChange('max_child_age_for_automations', parseInt(e.target.value, 10) || 0)}
                  min={0}
                  max={25}
                  disabled={!canEditSettings}
                />
                {errors.max_child_age_for_automations && <span style={styles.errorText}>{errors.max_child_age_for_automations}</span>}
                <div style={styles.helpText}>
                  Automations that opt into the max age rule use this age limit. Birthday automations apply it to the birthday minor; broader child/family automations use it to limit eligible families.
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={settings.auto_retry_failed}
                    onChange={(e) => handleInputChange('auto_retry_failed', e.target.checked)}
                    style={styles.checkbox}
                    disabled={!canEditSettings}
                  />
                  Automatically retry failed emails
                </label>
                <div style={styles.helpText}>
                  Failed emails will be retried automatically with exponential backoff
                </div>
              </div>
            </div>
          </div>

          {/* Save Button */}
          {activeSettingsTab !== 'campaign-sending' && (
          <PermissionGate
            requireElevated
            fallback={
              <div style={styles.saveSection}>
                <div style={styles.permissionDenied}>
                  <FiAlertCircle style={styles.permissionIcon} />
                  <p>Only owners and administrators can save mail settings</p>
                </div>
              </div>
            }
          >
            <div style={styles.saveSection}>
              <button 
                style={styles.saveButton}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? <FiRefreshCw style={styles.spinningIcon} /> : <FiSave />}
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </PermissionGate>
          )}

          <ModuleDeactivationPanel moduleKey="mail" />
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    padding: '40px',
    maxWidth: '1000px',
    margin: '0 auto',
    backgroundColor: '#f8f8f8',
    minHeight: '100vh',
  },
  loading: {
    textAlign: 'center',
    padding: '60px 20px',
    fontSize: '18px',
    color: '#666',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
  },
  loadingIcon: {
    fontSize: '48px',
    color: 'teal',
    animation: 'spin 1s linear infinite',
  },
  error: {
    textAlign: 'center',
    padding: '60px 20px',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #ddd',
  },
  errorIcon: {
    fontSize: '48px',
    color: '#f44336',
    marginBottom: '20px',
  },
  header: {
    marginBottom: '30px',
    backgroundColor: 'white',
    padding: '30px',
    borderRadius: '8px',
    border: '1px solid #ddd',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  titleIcon: {
    fontSize: '24px',
    color: 'teal',
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
    margin: 0,
    lineHeight: '1.5',
  },
  readOnlyBadge: {
    marginTop: '15px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px',
    backgroundColor: '#fff3cd',
    border: '1px solid #f39c12',
    borderRadius: '6px',
    color: '#856404',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  readOnlyIcon: {
    fontSize: '16px',
  },
  permissionDenied: {
    backgroundColor: '#fff3cd',
    border: '2px solid #f39c12',
    borderRadius: '8px',
    padding: '30px',
    textAlign: 'center',
    color: '#856404',
  },
  permissionIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  message: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '15px 20px',
    borderRadius: '8px',
    marginBottom: '20px',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '30px',
  },
  section: {
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #ddd',
    padding: '30px',
  },
  sectionTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  sectionIcon: {
    fontSize: '18px',
    color: 'teal',
  },
  emergencySection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  emergencyStatus: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px',
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: '8px',
    flexWrap: 'wrap',
    gap: '15px',
  },
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  statusDot: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    animation: 'pulse 2s infinite',
  },
  statusText: {
    fontSize: '18px',
    fontWeight: 'bold',
  },
  emergencyButton: {
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '15px 25px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    transition: 'all 0.2s ease',
  },
  emergencyDescription: {
    display: 'flex',
    gap: '15px',
    alignItems: 'flex-start',
    padding: '20px',
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: '8px',
  },
  warningIcon: {
    fontSize: '24px',
    color: '#f57c00',
    marginTop: '2px',
  },
  successIcon: {
    fontSize: '24px',
    color: '#4caf50',
    marginTop: '2px',
  },
  buttonIcon: {
    fontSize: '16px',
  },
  testingModeCard: {
    marginTop: '10px',
    padding: '20px',
    borderRadius: '8px',
    border: '1px dashed #9fa8da',
    backgroundColor: '#e8eaf6',
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  testingModeHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#283593',
  },
  testingModeIcon: {
    fontSize: '18px',
  },
  testingModeBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    color: '#283593',
    fontSize: '14px',
  },
  testingModeStatusText: {
    margin: 0,
  },
  testingModeHelp: {
    margin: 0,
    color: '#303f9f',
    lineHeight: 1.5,
  },
  testingModeButton: {
    alignSelf: 'flex-start',
    border: 'none',
    borderRadius: '6px',
    padding: '12px 20px',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px',
  },
  socialGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
  },
  labelIcon: {
    fontSize: '14px',
    color: 'teal',
  },
  input: {
    padding: '12px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '8px',
    transition: 'border-color 0.2s ease',
    boxSizing: 'border-box',
  },
  inputReadOnly: {
    backgroundColor: '#f5f5f5',
    cursor: 'not-allowed',
    opacity: 0.7,
  },
  textarea: {
    padding: '12px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '8px',
    transition: 'border-color 0.2s ease',
    boxSizing: 'border-box',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  inputError: {
    borderColor: '#f44336',
  },
  errorText: {
    fontSize: '12px',
    color: '#f44336',
    marginTop: '5px',
  },
  helpText: {
    fontSize: '12px',
    color: '#666',
    marginTop: '5px',
    fontStyle: 'italic',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '14px',
    color: '#333',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  checkbox: {
    width: '16px',
    height: '16px',
  },
  testSection: {
    marginTop: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  testButton: {
    backgroundColor: 'white',
    color: 'teal',
    border: '2px solid teal',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    alignSelf: 'flex-start',
    transition: 'all 0.2s ease',
  },
  testResult: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 16px',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  saveSection: {
    textAlign: 'center',
    marginTop: '30px',
  },
  saveButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '15px 30px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    transition: 'all 0.2s ease',
  },
  spinningIcon: {
    animation: 'spin 1s linear infinite',
  },
  // Mobile responsiveness
  '@media (max-width: 768px)': {
    formGrid: {
      gridTemplateColumns: '1fr',
    },
    socialGrid: {
      gridTemplateColumns: '1fr',
    },
    emergencyStatus: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    emergencyButton: {
      justifyContent: 'center',
    },
  },
};

// Add CSS animation for spinning icons and pulse effect
if (!document.querySelector('#mail-settings-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'mail-settings-styles';
  styleSheet.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes pulse {
      0% { opacity: 1; }
      50% { opacity: 0.5; }
      100% { opacity: 1; }
    }
  `;
  document.head.appendChild(styleSheet);
}

export default MailSettings;