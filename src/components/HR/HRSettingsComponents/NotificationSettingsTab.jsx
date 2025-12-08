// components/HR/HRSettingsComponents/NotificationSettingsTab.jsx - Notification Settings
import React, { useState, useEffect } from 'react';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../Auth/POSAuthWrapper';
import TavariCheckbox from '../../UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';
import { supabase } from '../../../supabaseClient';
import { AlertCircle, Mail, Send } from 'lucide-react';
import toast from 'react-hot-toast';

const NotificationSettingsTab = ({
  settings,
  onSettingsChange,
  selectedBusinessId,
  businessData,
  userRole,
  authUser,
  saving
}) => {
  // Security context for notification settings
  const {
    validateInput,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'NotificationSettingsTab',
    sensitiveComponent: false,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  // State for test email
  const [testingEmail, setTestingEmail] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [showTestInput, setShowTestInput] = useState(false);

  const handleInputChange = async (field, value) => {
    await logSecurityEvent('notification_settings_change', {
      field,
      business_id: selectedBusinessId
    }, 'low');

    onSettingsChange(field, value);
  };

  // Validate email format
  const validateEmail = (email) => {
    if (!email || !email.trim()) return { valid: false, message: 'Email is required' };
    
    const trimmedEmail = email.trim();
    
    // Check for common typos (forward slash instead of dot)
    if (trimmedEmail.includes('/') && !trimmedEmail.includes('.')) {
      const correctedEmail = trimmedEmail.replace(/\//g, '.');
      return { 
        valid: false, 
        message: `Invalid email format. Did you mean "${correctedEmail}"? (Forward slashes "/" should be dots ".")` 
      };
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return { 
        valid: false, 
        message: `Invalid email format. Please check for typos (e.g., "${trimmedEmail}" should have a dot "." in the domain, not "/")` 
      };
    }
    
    return { valid: true };
  };

  // Test email functionality - simple test email like pay statements/contracts
  const handleTestEmail = async (testToEmail) => {
    console.log('[TestEmail] Starting test email function...', { testToEmail, selectedBusinessId });
    
    if (!testToEmail || !testToEmail.trim()) {
      console.log('[TestEmail] Validation failed: No email address provided');
      toast.error('Please enter a test email address');
      return;
    }

    const emailValidation = validateEmail(testToEmail);
    if (!emailValidation.valid) {
      console.log('[TestEmail] Validation failed: Invalid email format', emailValidation);
      toast.error(emailValidation.message);
      return;
    }

    if (!settings.notification_email) {
      console.log('[TestEmail] Validation failed: Notification recipient email not set');
      toast.error('Notification recipient email must be set before testing');
      return;
    }

    if (!settings.notification_display_name) {
      console.log('[TestEmail] Validation failed: Display name not set');
      toast.error('Email display name must be set before testing');
      return;
    }

    if (!selectedBusinessId) {
      console.log('[TestEmail] Validation failed: No business ID available');
      toast.error('Business ID is required to send test email');
      return;
    }

    setTestingEmail(true);
    try {
      const displayName = settings.notification_display_name || `${businessData?.name || businessData?.business_name || 'Company'} - HR`;
      
      console.log('[TestEmail] Preparing email payload...', {
        displayName,
        testToEmail: testToEmail.trim(),
        selectedBusinessId,
        hasNotificationEmail: !!settings.notification_email
      });
      
      // Create a simple test email body (matching pattern from pay statements/contracts)
      const testEmailBody = `
        <h2>HR Notification Test Email</h2>
        <p>This is a test email to verify your HR notification settings are configured correctly.</p>
        <p><strong>Configuration Details:</strong></p>
        <ul>
          <li>Display Name: ${displayName}</li>
          <li>From Email: noreply@tavarios.ca</li>
          <li>Recipient Email: ${settings.notification_email}</li>
          <li>Test Email To: ${testToEmail.trim()}</li>
        </ul>
        <p>If you receive this email, your notification settings are working correctly.</p>
        <hr>
        <p style="font-size: 12px; color: #666;">This email was sent from the Tavari HR system as a test notification.</p>
      `;

      // Prepare email payload with all required fields (matching pay statement pattern)
      const emailPayload = {
        businessId: selectedBusinessId,
        campaignId: `hr-notification-test-${Date.now()}`,
        contactId: authUser?.id || 'test-contact', // Use current user ID or test contact ID
        to: testToEmail.trim(),
        subject: '[TEST] HR Notification Test Email',
        html: testEmailBody,
        fromEmail: 'noreply@tavarios.ca',
        fromName: displayName
      };

      console.log('[TestEmail] Calling mail-send Edge Function...', {
        payload: {
          ...emailPayload,
          html: `[HTML Content - ${testEmailBody.length} characters]`
        }
      });

      // Send test email via mail-send function (matching pay statement/contract pattern)
      const { data, error } = await supabase.functions.invoke('mail-send', {
        body: emailPayload
      });

      console.log('[TestEmail] Edge Function response:', { data, error });

      if (error) {
        console.error('[TestEmail] Edge Function returned error:', {
          error,
          errorMessage: error.message,
          errorContext: error.context,
          errorStack: error.stack
        });
        throw error;
      }

      console.log('[TestEmail] Email sent successfully!', { data });

      toast.success(`Test email sent to ${testToEmail.trim()}`);
      setShowTestInput(false);
      setTestEmailAddress('');
      recordAction('test_notification_email', selectedBusinessId);
      
      await logSecurityEvent('test_notification_email_sent', {
        test_email: testToEmail.trim(),
        display_name: displayName,
        business_id: selectedBusinessId
      }, 'low');
    } catch (error) {
      console.error('[TestEmail] Error sending test email:', {
        error,
        errorMessage: error.message,
        errorContext: error.context,
        errorStack: error.stack,
        errorDetails: error.details || error
      });
      
      const errorMessage = error.message || error.context?.message || 'Unknown error';
      toast.error(`Failed to send test email: ${errorMessage}`);
      
      await logSecurityEvent('test_notification_email_failed', {
        error_message: errorMessage,
        error_details: JSON.stringify(error),
        business_id: selectedBusinessId
      }, 'medium');
    } finally {
      setTestingEmail(false);
      console.log('[TestEmail] Test email function completed');
    }
  };

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xl
    },
    section: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.xl,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      margin: `0 0 ${TavariStyles.spacing.lg} 0`
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
      gap: TavariStyles.spacing.xl
    },
    inputGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700
    },
    input: {
      ...TavariStyles.components.form?.input || {
        padding: '12px 16px',
        border: `1px solid ${TavariStyles.colors.gray300}`,
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        fontSize: TavariStyles.typography.fontSize.sm,
        backgroundColor: TavariStyles.colors.white
      },
      width: '90%'
    },
    select: {
      ...TavariStyles.components.form?.select || {
        padding: '12px 16px',
        border: `1px solid ${TavariStyles.colors.gray300}`,
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        fontSize: TavariStyles.typography.fontSize.sm,
        backgroundColor: TavariStyles.colors.white,
        cursor: 'pointer'
      },
      width: '90%'
    },
    toggleGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.lg
    },
    toggleItem: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    description: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      marginTop: TavariStyles.spacing.xs
    },
    infoBox: {
      backgroundColor: TavariStyles.colors.infoBg,
      color: TavariStyles.colors.infoText,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.xs,
      marginTop: TavariStyles.spacing.md
    },
    warningBox: {
      backgroundColor: TavariStyles.colors.warningBg || '#fef3c7',
      border: `1px solid ${TavariStyles.colors.warning || '#f59e0b'}`,
      color: TavariStyles.colors.warningText || '#92400e',
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      marginTop: TavariStyles.spacing.sm,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    templateSection: {
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      padding: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50
    },
    templateHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      cursor: 'pointer',
      padding: TavariStyles.spacing.sm,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      transition: 'background-color 0.2s'
    },
    templateHeaderHover: {
      backgroundColor: TavariStyles.colors.gray100
    },
    templateContent: {
      marginTop: TavariStyles.spacing.md,
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md
    },
    textarea: {
      ...TavariStyles.components.form?.textarea || {
        padding: '12px 16px',
        border: `1px solid ${TavariStyles.colors.gray300}`,
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        fontSize: TavariStyles.typography.fontSize.sm,
        fontFamily: 'inherit',
        minHeight: '100px',
        resize: 'vertical'
      },
      width: '90%'
    },
    testEmailSection: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      alignItems: 'flex-end',
      marginTop: TavariStyles.spacing.sm
    },
    testEmailInput: {
      flex: 1,
      maxWidth: '90%',
      ...TavariStyles.components.form?.input || {
        padding: '12px 16px',
        border: `1px solid ${TavariStyles.colors.gray300}`,
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        fontSize: TavariStyles.typography.fontSize.sm
      }
    },
    testButton: {
      ...TavariStyles.components.button?.base || {},
      ...TavariStyles.components.button?.variants?.primary || {
        backgroundColor: TavariStyles.colors.primary,
        color: 'white',
        border: 'none',
        padding: '12px 24px',
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        fontSize: TavariStyles.typography.fontSize.sm,
        fontWeight: TavariStyles.typography.fontWeight.medium,
        cursor: 'pointer'
      },
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    buttonSecondary: {
      ...TavariStyles.components.button?.base || {},
      backgroundColor: TavariStyles.colors.gray200,
      color: TavariStyles.colors.gray700,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      padding: '12px 24px',
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    placeholderHint: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      fontStyle: 'italic',
      marginTop: TavariStyles.spacing.xs
    }
  };

  return (
    <div style={styles.container}>
      {/* Primary Notification Settings */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Primary Notification Settings</h3>
        
        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Notification Recipient Email *
            </label>
            <input
              type="email"
              value={settings.notification_email || ''}
              onChange={(e) => handleInputChange('notification_email', e.target.value)}
              disabled={saving}
              style={{
                ...styles.input,
                ...(!settings.notification_email || !validateEmail(settings.notification_email).valid ? {
                  borderColor: TavariStyles.colors.danger || '#dc2626'
                } : {})
              }}
              placeholder="hr@company.com"
            />
            {!settings.notification_email && (
              <div style={styles.warningBox}>
                <AlertCircle size={20} />
                <span>Notification recipient email is required for warnings to work</span>
              </div>
            )}
            {settings.notification_email && !validateEmail(settings.notification_email).valid && (
              <div style={styles.warningBox}>
                <AlertCircle size={20} />
                <span>{validateEmail(settings.notification_email).message}</span>
              </div>
            )}
            <span style={styles.description}>
              Email address that will receive all HR warning notifications
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Email Display Name *
            </label>
            <input
              type="text"
              value={settings.notification_display_name || ''}
              onChange={(e) => handleInputChange('notification_display_name', e.target.value)}
              disabled={saving}
              style={styles.input}
              placeholder={`${businessData?.name || businessData?.business_name || 'Company'} - HR`}
            />
            {(!settings.notification_display_name || (typeof settings.notification_display_name === 'string' && settings.notification_display_name.trim() === '')) ? (
              <div style={styles.warningBox}>
                <AlertCircle size={20} />
                <span>Email display name is required</span>
              </div>
            ) : null}
            <span style={styles.description}>
              The name that will appear as the sender (e.g., "Company Name - HR"). Emails are sent from noreply@tavarios.ca with this display name.
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Secondary Notification Email (Optional)
            </label>
            <input
              type="email"
              value={settings.secondary_notification_email || ''}
              onChange={(e) => handleInputChange('secondary_notification_email', e.target.value)}
              disabled={saving}
              style={styles.input}
              placeholder="hr-backup@company.com"
            />
            <span style={styles.description}>
              Backup email address for critical HR notifications
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Manager Notification Email (Optional)
            </label>
            <input
              type="email"
              value={settings.manager_notification_email || ''}
              onChange={(e) => handleInputChange('manager_notification_email', e.target.value)}
              disabled={saving}
              style={styles.input}
              placeholder="management@company.com"
            />
            <span style={styles.description}>
              Email for management-level notifications and approvals
            </span>
          </div>
        </div>
        
        <div style={styles.infoBox}>
          <strong>Email Configuration:</strong> All warning emails are sent from <code>noreply@tavarios.ca</code> using the display name you configure above. 
          This matches the pattern used by Pay Statements and Contracts. The recipient email above is where warnings will be sent.
        </div>
      </div>

      {/* Contract and Employment Alerts */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Contract and Employment Alerts</h3>
        
        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Contract Expiry Warning (days)
            </label>
            <input
              type="number"
              min="1"
              max="365"
              value={settings.contract_expiry_warning_days || 30}
              onChange={(e) => handleInputChange('contract_expiry_warning_days', parseInt(e.target.value) || 30)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Days before contract expiry to send warning notifications
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Probation Period Ending Warning (days)
            </label>
            <input
              type="number"
              min="1"
              max="30"
              value={settings.probation_ending_warning_days || 7}
              onChange={(e) => handleInputChange('probation_ending_warning_days', parseInt(e.target.value) || 7)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Days before probation period ends to send notifications
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Anniversary Notification
            </label>
            <select
              value={settings.anniversary_notification_timing || 'week_before'}
              onChange={(e) => handleInputChange('anniversary_notification_timing', e.target.value)}
              disabled={saving}
              style={styles.select}
            >
              <option value="disabled">Disabled</option>
              <option value="day_of">Day of Anniversary</option>
              <option value="week_before">Week Before</option>
              <option value="month_before">Month Before</option>
            </select>
            <span style={styles.description}>
              When to send employee work anniversary notifications
            </span>
          </div>
        </div>

        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_contract_renewals ?? true}
              onChange={(checked) => handleInputChange('notify_contract_renewals', checked)}
              label="Notify for contract renewals"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Send notifications when employee contracts are up for renewal
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_employment_milestones ?? true}
              onChange={(checked) => handleInputChange('notify_employment_milestones', checked)}
              label="Notify for employment milestones"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Send notifications for work anniversaries and employment milestones
            </span>
          </div>
        </div>

        {/* Test Email Functionality */}
        <div style={{marginTop: TavariStyles.spacing.xl, padding: TavariStyles.spacing.lg, backgroundColor: TavariStyles.colors.gray50, borderRadius: TavariStyles.borderRadius?.md || '6px'}}>
          <h4 style={{...styles.sectionTitle, fontSize: TavariStyles.typography.fontSize.lg, marginBottom: TavariStyles.spacing.md}}>
            Test Email Notifications
          </h4>
          <p style={styles.description}>
            Send a test email to verify your notification settings are working correctly. The test email will be sent from noreply@tavarios.ca using your configured display name.
          </p>

          {!settings.notification_email && (
            <div style={styles.warningBox}>
              <AlertCircle size={16} />
              <span style={{fontSize: TavariStyles.typography.fontSize.xs}}>
                Please set a notification recipient email before testing
              </span>
            </div>
          )}

          {!settings.notification_display_name && (
            <div style={styles.warningBox}>
              <AlertCircle size={16} />
              <span style={{fontSize: TavariStyles.typography.fontSize.xs}}>
                Please set an email display name before testing
              </span>
            </div>
          )}

          {settings.notification_email && settings.notification_display_name && (
            <div style={{display: 'flex', gap: TavariStyles.spacing.sm, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: TavariStyles.spacing.md}}>
              {!showTestInput ? (
                <button
                  onClick={() => setShowTestInput(true)}
                  disabled={saving || testingEmail}
                  style={styles.testButton}
                >
                  <Send size={16} />
                  Send Test Email
                </button>
              ) : (
                <div style={styles.testEmailSection}>
                  <input
                    type="email"
                    value={testEmailAddress}
                    onChange={(e) => setTestEmailAddress(e.target.value)}
                    placeholder="Enter test email address"
                    style={styles.testEmailInput}
                    disabled={saving || testingEmail}
                  />
                  <button
                    onClick={() => handleTestEmail(testEmailAddress)}
                    disabled={saving || testingEmail || !testEmailAddress.trim() || !settings.notification_email || !settings.notification_display_name}
                    style={styles.testButton}
                  >
                    <Send size={16} />
                    {testingEmail ? 'Sending...' : 'Send Test'}
                  </button>
                  <button
                    onClick={() => {
                      setShowTestInput(false);
                      setTestEmailAddress('');
                    }}
                    disabled={saving || testingEmail}
                    style={styles.buttonSecondary}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Policy and Training Notifications */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Policy and Training Notifications</h3>
        
        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Policy Acknowledgment Deadline (days)
            </label>
            <input
              type="number"
              min="1"
              max="90"
              value={settings.policy_acknowledgment_deadline_days || 14}
              onChange={(e) => handleInputChange('policy_acknowledgment_deadline_days', parseInt(e.target.value) || 14)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Days employees have to acknowledge new policies before escalation
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Training Deadline Warning (days)
            </label>
            <input
              type="number"
              min="1"
              max="30"
              value={settings.training_deadline_warning_days || 7}
              onChange={(e) => handleInputChange('training_deadline_warning_days', parseInt(e.target.value) || 7)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Days before training deadline to send reminder notifications
            </span>
          </div>
        </div>

        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_policy_updates ?? true}
              onChange={(checked) => handleInputChange('notify_policy_updates', checked)}
              label="Notify employees of policy updates"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Automatically notify employees when policies are updated or new policies are added
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_training_assignments ?? true}
              onChange={(checked) => handleInputChange('notify_training_assignments', checked)}
              label="Notify employees of training assignments"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Send notifications when new training is assigned to employees
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_overdue_acknowledgments ?? true}
              onChange={(checked) => handleInputChange('notify_overdue_acknowledgments', checked)}
              label="Notify managers of overdue acknowledgments"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Alert managers when employees have overdue policy acknowledgments or training
            </span>
          </div>
        </div>
      </div>

      {/* Leave and Attendance Notifications */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Leave and Attendance Notifications</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_leave_requests ?? true}
              onChange={(checked) => handleInputChange('notify_leave_requests', checked)}
              label="Notify managers of leave requests"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Send immediate notifications to managers when leave requests are submitted
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_attendance_issues ?? true}
              onChange={(checked) => handleInputChange('notify_attendance_issues', checked)}
              label="Notify of attendance issues"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Alert managers about excessive tardiness, absences, or attendance patterns
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_low_leave_balances ?? false}
              onChange={(checked) => handleInputChange('notify_low_leave_balances', checked)}
              label="Notify employees of low leave balances"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Alert employees when their vacation or sick leave balances are running low
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_leave_balance_expiry ?? true}
              onChange={(checked) => handleInputChange('notify_leave_balance_expiry', checked)}
              label="Notify of upcoming leave balance expiry"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Warn employees before vacation time expires or is forfeited
            </span>
          </div>
        </div>
      </div>

      {/* Payroll and Benefits Notifications */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Payroll and Benefits Notifications</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_payroll_processed ?? true}
              onChange={(checked) => handleInputChange('notify_payroll_processed', checked)}
              label="Notify when payroll is processed"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Send notifications to HR when payroll runs are successfully processed
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_payroll_errors ?? true}
              onChange={(checked) => handleInputChange('notify_payroll_errors', checked)}
              label="Notify of payroll errors"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Immediate alerts for payroll processing errors or validation failures
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_wage_changes ?? true}
              onChange={(checked) => handleInputChange('notify_wage_changes', checked)}
              label="Notify of wage changes"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Alert HR and managers when employee wages or salaries are modified
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_benefits_eligibility ?? true}
              onChange={(checked) => handleInputChange('notify_benefits_eligibility', checked)}
              label="Notify of benefits eligibility changes"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Alert when employees become eligible for benefits or when eligibility changes
            </span>
          </div>
        </div>
      </div>

      {/* System and Security Notifications */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>System and Security Notifications</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_failed_login_attempts ?? true}
              onChange={(checked) => handleInputChange('notify_failed_login_attempts', checked)}
              label="Notify of failed login attempts"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Alert HR of repeated failed login attempts or potential security issues
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_data_exports ?? true}
              onChange={(checked) => handleInputChange('notify_data_exports', checked)}
              label="Notify of employee data exports"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Alert when employee data is exported from the system
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.notify_system_maintenance ?? true}
              onChange={(checked) => handleInputChange('notify_system_maintenance', checked)}
              label="Notify of scheduled maintenance"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Send advance notifications of scheduled system maintenance windows
            </span>
          </div>
        </div>

        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Failed Login Threshold
            </label>
            <input
              type="number"
              min="1"
              max="20"
              value={settings.failed_login_threshold || 5}
              onChange={(e) => handleInputChange('failed_login_threshold', parseInt(e.target.value) || 5)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Number of failed login attempts before triggering security notification
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Notification Frequency
            </label>
            <select
              value={settings.notification_frequency || 'immediate'}
              onChange={(e) => handleInputChange('notification_frequency', e.target.value)}
              disabled={saving}
              style={styles.select}
            >
              <option value="immediate">Immediate</option>
              <option value="hourly">Hourly Digest</option>
              <option value="daily">Daily Digest</option>
              <option value="weekly">Weekly Summary</option>
            </select>
            <span style={styles.description}>
              How frequently to send non-critical notifications
            </span>
          </div>
        </div>

        <div style={styles.infoBox}>
          <strong>Email Configuration:</strong> Ensure your email server is properly configured to send notifications. 
          Test notifications regularly to verify delivery. Critical alerts are always sent immediately regardless of frequency settings.
        </div>
      </div>
    </div>
  );
};

export default NotificationSettingsTab;