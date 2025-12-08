// components/HR/HRSettingsComponents/ApprovalSettingsTab.jsx - Approval Requirements Settings
import React from 'react';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../Auth/POSAuthWrapper';
import TavariCheckbox from '../../UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';

const ApprovalSettingsTab = ({
  settings,
  onSettingsChange,
  selectedBusinessId,
  businessData,
  userRole,
  authUser,
  saving
}) => {
  // Security context for sensitive approval settings
  const {
    validateInput,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'ApprovalSettingsTab',
    sensitiveComponent: true,
    enableAuditLogging: true,
    securityLevel: 'medium'
  });

  const handleInputChange = async (field, value) => {
    await logSecurityEvent('approval_settings_change', {
      field,
      new_value: typeof value === 'boolean' ? value : 'redacted',
      business_id: selectedBusinessId
    }, 'low');

    onSettingsChange(field, value);
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
    description: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      marginTop: TavariStyles.spacing.xs
    },
    warningBox: {
      backgroundColor: TavariStyles.colors.warningBg,
      color: TavariStyles.colors.warningText,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.xs,
      marginTop: TavariStyles.spacing.md
    }
  };

  return (
    <div style={styles.container}>
      {/* Disciplinary Actions */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Disciplinary Actions</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_manager_approval_writeups ?? true}
              onChange={(checked) => handleInputChange('require_manager_approval_writeups', checked)}
              label="Require manager approval for disciplinary writeups"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              All disciplinary actions must be reviewed and approved by a manager before being finalized
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_hr_approval_terminations ?? true}
              onChange={(checked) => handleInputChange('require_hr_approval_terminations', checked)}
              label="Require HR approval for terminations"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              All employee terminations must be approved by HR before being processed
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_documentation_writeups ?? true}
              onChange={(checked) => handleInputChange('require_documentation_writeups', checked)}
              label="Require documentation for all writeups"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Supporting documentation must be attached to all disciplinary actions
            </span>
          </div>
        </div>
      </div>

      {/* Policy and Procedure Changes */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Policy and Procedure Changes</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_manager_approval_policy_changes ?? true}
              onChange={(checked) => handleInputChange('require_manager_approval_policy_changes', checked)}
              label="Require manager approval for policy changes"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              All policy modifications must be approved by a manager before implementation
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_legal_review_policy_changes ?? false}
              onChange={(checked) => handleInputChange('require_legal_review_policy_changes', checked)}
              label="Require legal review for major policy changes"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Major policy changes require legal review before approval and implementation
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_employee_acknowledgment_policies ?? true}
              onChange={(checked) => handleInputChange('require_employee_acknowledgment_policies', checked)}
              label="Require employee acknowledgment of new policies"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Employees must acknowledge receipt and understanding of new or updated policies
            </span>
          </div>
        </div>
      </div>

      {/* Time and Attendance */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Time and Attendance</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_manager_approval_overtime ?? true}
              onChange={(checked) => handleInputChange('require_manager_approval_overtime', checked)}
              label="Require manager approval for overtime"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Overtime hours must be pre-approved by a manager before being worked
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_manager_approval_schedule_changes ?? false}
              onChange={(checked) => handleInputChange('require_manager_approval_schedule_changes', checked)}
              label="Require manager approval for schedule changes"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              All schedule modifications must be approved by a manager
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.auto_approve_time_corrections ?? false}
              onChange={(checked) => handleInputChange('auto_approve_time_corrections', checked)}
              label="Auto-approve minor time corrections"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Automatically approve time corrections under 15 minutes without manager review
            </span>
          </div>
        </div>

        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Overtime Threshold (hours per day)
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              max="16"
              value={settings.daily_overtime_threshold || 8}
              onChange={(e) => handleInputChange('daily_overtime_threshold', parseFloat(e.target.value) || 0)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Hours worked per day before overtime approval is required
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Weekly Overtime Threshold (hours)
            </label>
            <input
              type="number"
              min="0"
              max="80"
              value={settings.weekly_overtime_threshold || 44}
              onChange={(e) => handleInputChange('weekly_overtime_threshold', parseInt(e.target.value) || 0)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Hours worked per week before overtime rates apply (Canadian standard: 44 hours)
            </span>
          </div>
        </div>
      </div>

      {/* Payroll Approvals */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Payroll Approvals</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_manager_approval_payroll ?? true}
              onChange={(checked) => handleInputChange('require_manager_approval_payroll', checked)}
              label="Require manager approval before payroll processing"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Payroll runs must be reviewed and approved by a manager before processing
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_dual_approval_payroll ?? false}
              onChange={(checked) => handleInputChange('require_dual_approval_payroll', checked)}
              label="Require dual approval for payroll processing"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Payroll runs require approval from two different managers before processing
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_approval_bonus_payments ?? true}
              onChange={(checked) => handleInputChange('require_approval_bonus_payments', checked)}
              label="Require approval for bonus payments"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              All bonus and incentive payments must be pre-approved
            </span>
          </div>
        </div>

        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Auto-approval Threshold ($)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={settings.payroll_auto_approval_threshold || 0}
              onChange={(e) => handleInputChange('payroll_auto_approval_threshold', parseFloat(e.target.value) || 0)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Payroll amounts under this threshold can be processed without approval (0 = always require approval)
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Approval Timeout (hours)
            </label>
            <input
              type="number"
              min="1"
              max="168"
              value={settings.approval_timeout_hours || 48}
              onChange={(e) => handleInputChange('approval_timeout_hours', parseInt(e.target.value) || 48)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Hours before approval requests automatically escalate to higher management
            </span>
          </div>
        </div>
      </div>

      {/* Employee Profile Changes */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Employee Profile Changes</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_manager_approval_profile_changes ?? false}
              onChange={(checked) => handleInputChange('require_manager_approval_profile_changes', checked)}
              label="Require manager approval for profile changes"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Employee profile updates must be approved by a manager before taking effect
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_approval_wage_changes ?? true}
              onChange={(checked) => handleInputChange('require_approval_wage_changes', checked)}
              label="Require approval for wage changes"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              All wage and salary adjustments must be pre-approved by management
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_approval_role_changes ?? true}
              onChange={(checked) => handleInputChange('require_approval_role_changes', checked)}
              label="Require approval for role/department changes"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Changes to employee roles, departments, or job titles require manager approval
            </span>
          </div>
        </div>
      </div>

      {/* Onboarding and Training */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Onboarding and Training</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.onboarding_completion_required ?? true}
              onChange={(checked) => handleInputChange('onboarding_completion_required', checked)}
              label="Require onboarding completion before full access"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Employees must complete onboarding process before gaining full system access
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_training_completion ?? false}
              onChange={(checked) => handleInputChange('require_training_completion', checked)}
              label="Require mandatory training completion"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Employees must complete mandatory training modules within specified timeframes
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_manager_onboarding_sign_off ?? true}
              onChange={(checked) => handleInputChange('require_manager_onboarding_sign_off', checked)}
              label="Require manager sign-off on onboarding completion"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Manager must confirm that new employee onboarding has been completed successfully
            </span>
          </div>
        </div>

        <div style={styles.warningBox}>
          <strong>Important:</strong> Approval requirements help ensure compliance and maintain proper oversight. 
          However, too many approval steps can slow down operations. Balance security with efficiency based on your business needs.
        </div>
      </div>
    </div>
  );
};

export default ApprovalSettingsTab;