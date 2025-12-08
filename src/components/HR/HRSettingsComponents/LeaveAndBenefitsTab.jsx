// components/HR/HRSettingsComponents/LeaveAndBenefitsTab.jsx - Leave and Benefits Settings with Vacation Payout Options
import React from 'react';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../Auth/POSAuthWrapper';
import TavariCheckbox from '../../UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';

const LeaveAndBenefitsTab = ({
  settings,
  onSettingsChange,
  selectedBusinessId,
  businessData,
  userRole,
  authUser,
  saving
}) => {
  // Security context for sensitive benefits settings
  const {
    validateInput,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'LeaveAndBenefitsTab',
    sensitiveComponent: true,
    enableAuditLogging: true,
    securityLevel: 'medium'
  });

  const handleInputChange = async (field, value) => {
    await logSecurityEvent('benefits_settings_change', {
      field,
      new_value: typeof value === 'number' ? value : 'redacted',
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
        transition: 'border-color 0.2s',
        fontFamily: 'inherit',
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
      marginTop: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.xs
    },
    warningBox: {
      backgroundColor: TavariStyles.colors.warningBg,
      color: TavariStyles.colors.warningText,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginTop: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.xs
    }
  };

  return (
    <div style={styles.container}>
      {/* Vacation Configuration */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Vacation Configuration</h3>
        
        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Vacation Payment Method
            </label>
            <select
              value={settings.vacation_payout_method || 'accrual'}
              onChange={(e) => handleInputChange('vacation_payout_method', e.target.value)}
              disabled={saving}
              style={styles.select}
            >
              <option value="accrual">Accrual (Bank Hours)</option>
              <option value="payout">Payout Each Pay Period</option>
              <option value="hybrid">Hybrid (Partial Accrual + Payout)</option>
            </select>
            <span style={styles.description}>
              Choose how vacation time is handled: accrual banks hours for later use, payout pays vacation pay each period, hybrid combines both
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Vacation Accrual Rate (% per pay period)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="20"
              value={settings.vacation_accrual_rate || 4.00}
              onChange={(e) => handleInputChange('vacation_accrual_rate', parseFloat(e.target.value) || 0)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Percentage of gross pay for vacation {settings.vacation_payout_method === 'payout' ? '(paid each period)' : '(accrued as hours)'} (Canadian standard: 4%)
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Vacation Calculation Method
            </label>
            <select
              value={settings.vacation_accrual_method || 'percentage'}
              onChange={(e) => handleInputChange('vacation_accrual_method', e.target.value)}
              disabled={saving}
              style={styles.select}
            >
              <option value="percentage">Percentage of Gross Pay</option>
              <option value="hours_worked">Based on Hours Worked</option>
              <option value="fixed_amount">Fixed Amount per Period</option>
            </select>
            <span style={styles.description}>
              How vacation entitlement is calculated each pay period
            </span>
          </div>
        </div>

        {/* Conditional fields based on vacation method */}
        {settings.vacation_payout_method !== 'payout' && (
          <div style={styles.grid}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>
                Maximum Vacation Accrual (hours)
              </label>
              <input
                type="number"
                min="0"
                max="1000"
                value={settings.max_vacation_accrual_hours || 240}
                onChange={(e) => handleInputChange('max_vacation_accrual_hours', parseInt(e.target.value) || 0)}
                disabled={saving}
                style={styles.input}
              />
              <span style={styles.description}>
                Maximum vacation hours an employee can accumulate before accrual stops
              </span>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>
                Vacation Year Start Date
              </label>
              <select
                value={settings.vacation_year_start || 'january'}
                onChange={(e) => handleInputChange('vacation_year_start', e.target.value)}
                disabled={saving}
                style={styles.select}
              >
                <option value="january">January 1st</option>
                <option value="april">April 1st</option>
                <option value="hire_date">Employee Hire Date Anniversary</option>
              </select>
              <span style={styles.description}>
                When the vacation year resets for each employee
              </span>
            </div>
          </div>
        )}

        {settings.vacation_payout_method === 'hybrid' && (
          <div style={styles.infoBox}>
            <strong>Hybrid Vacation Method:</strong><br />
            With hybrid method, a portion of vacation pay is paid out each period while the remainder is accrued as banked hours. 
            Configure the split ratio in payroll settings.
          </div>
        )}

        {settings.vacation_payout_method === 'payout' && (
          <div style={styles.warningBox}>
            <strong>Vacation Payout Method:</strong><br />
            With payout method, vacation pay is included in each paycheck and employees don't accrue vacation hours. 
            This complies with some provincial requirements but employees won't have paid time off unless separately configured.
          </div>
        )}
      </div>

      {/* Sick Leave Settings */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Sick Leave Settings</h3>
        
        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Sick Leave Accrual Rate (% per pay period)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="10"
              value={settings.sick_leave_accrual_rate || 2.00}
              onChange={(e) => handleInputChange('sick_leave_accrual_rate', parseFloat(e.target.value) || 0)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Percentage of gross pay that accrues as sick leave each pay period
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Maximum Sick Leave Accrual (hours)
            </label>
            <input
              type="number"
              min="0"
              max="500"
              value={settings.max_sick_leave_accrual_hours || 120}
              onChange={(e) => handleInputChange('max_sick_leave_accrual_hours', parseInt(e.target.value) || 0)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Maximum sick leave hours an employee can accumulate
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Sick Leave Waiting Period (days)
            </label>
            <input
              type="number"
              min="0"
              max="90"
              value={settings.sick_leave_waiting_period || 90}
              onChange={(e) => handleInputChange('sick_leave_waiting_period', parseInt(e.target.value) || 0)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Days an employee must work before sick leave accrual begins
            </span>
          </div>
        </div>
      </div>

      {/* Personal Days and Other Leave */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Personal Days and Other Leave</h3>
        
        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Personal Days per Year
            </label>
            <input
              type="number"
              min="0"
              max="20"
              value={settings.personal_days_per_year || 0}
              onChange={(e) => handleInputChange('personal_days_per_year', parseInt(e.target.value) || 0)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Number of personal days granted to employees annually
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Bereavement Leave Days
            </label>
            <input
              type="number"
              min="0"
              max="10"
              value={settings.bereavement_leave_days || 3}
              onChange={(e) => handleInputChange('bereavement_leave_days', parseInt(e.target.value) || 0)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Days of bereavement leave for immediate family
            </span>
          </div>
        </div>
      </div>

      {/* Leave Request Settings - Only show if using accrual method */}
      {settings.vacation_payout_method !== 'payout' && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Leave Request Management</h3>
          
          <div style={styles.toggleGroup}>
            <div style={styles.toggleItem}>
              <TavariCheckbox
                checked={settings.require_manager_approval_vacation ?? true}
                onChange={(checked) => handleInputChange('require_manager_approval_vacation', checked)}
                label="Require manager approval for vacation requests"
                disabled={saving}
                size="md"
              />
              <span style={styles.description}>
                All vacation requests must be approved by a manager before being granted
              </span>
            </div>

            <div style={styles.toggleItem}>
              <TavariCheckbox
                checked={settings.require_advance_notice_vacation ?? true}
                onChange={(checked) => handleInputChange('require_advance_notice_vacation', checked)}
                label="Require advance notice for vacation requests"
                disabled={saving}
                size="md"
              />
              <span style={styles.description}>
                Employees must submit vacation requests with advance notice
              </span>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>
                Minimum Advance Notice (days)
              </label>
              <input
                type="number"
                min="0"
                max="60"
                value={settings.vacation_advance_notice_days || 14}
                onChange={(e) => handleInputChange('vacation_advance_notice_days', parseInt(e.target.value) || 0)}
                disabled={saving || !settings.require_advance_notice_vacation}
                style={styles.input}
              />
              <span style={styles.description}>
                Minimum days in advance that vacation requests must be submitted
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Statutory Holiday Settings */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Statutory Holidays</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.auto_apply_statutory_holidays ?? true}
              onChange={(checked) => handleInputChange('auto_apply_statutory_holidays', checked)}
              label="Automatically apply statutory holidays"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Automatically grant statutory holidays based on provincial regulations
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Province/Territory for Statutory Holidays
            </label>
            <select
              value={settings.statutory_holiday_province || 'ON'}
              onChange={(e) => handleInputChange('statutory_holiday_province', e.target.value)}
              disabled={saving}
              style={styles.select}
            >
              <option value="AB">Alberta</option>
              <option value="BC">British Columbia</option>
              <option value="MB">Manitoba</option>
              <option value="NB">New Brunswick</option>
              <option value="NL">Newfoundland and Labrador</option>
              <option value="NS">Nova Scotia</option>
              <option value="ON">Ontario</option>
              <option value="PE">Prince Edward Island</option>
              <option value="QC">Quebec</option>
              <option value="SK">Saskatchewan</option>
              <option value="NT">Northwest Territories</option>
              <option value="NU">Nunavut</option>
              <option value="YT">Yukon</option>
            </select>
            <span style={styles.description}>
              Province/territory that determines which statutory holidays apply
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.pay_statutory_holiday_premium ?? true}
              onChange={(checked) => handleInputChange('pay_statutory_holiday_premium', checked)}
              label="Pay statutory holiday premium"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Pay time-and-a-half for employees who work on statutory holidays
            </span>
          </div>
        </div>

        <div style={styles.infoBox}>
          <strong>Canadian Statutory Holiday Requirements:</strong><br />
          Statutory holiday entitlements vary by province. Ensure your settings comply with local employment standards.
        </div>
      </div>

      {/* Leave Balance Management - Only show for accrual methods */}
      {settings.vacation_payout_method !== 'payout' && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Leave Balance Management</h3>
          
          <div style={styles.toggleGroup}>
            <div style={styles.toggleItem}>
              <TavariCheckbox
                checked={settings.allow_negative_balances ?? false}
                onChange={(checked) => handleInputChange('allow_negative_balances', checked)}
                label="Allow negative leave balances"
                disabled={saving}
                size="md"
              />
              <span style={styles.description}>
                Employees can take leave even if they don't have sufficient accrued time
              </span>
            </div>

            <div style={styles.toggleItem}>
              <TavariCheckbox
                checked={settings.carryover_unused_vacation ?? true}
                onChange={(checked) => handleInputChange('carryover_unused_vacation', checked)}
                label="Allow vacation carryover to next year"
                disabled={saving}
                size="md"
              />
              <span style={styles.description}>
                Unused vacation time can be carried over to the next vacation year
              </span>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>
                Maximum Carryover Hours
              </label>
              <input
                type="number"
                min="0"
                max="200"
                value={settings.max_carryover_hours || 40}
                onChange={(e) => handleInputChange('max_carryover_hours', parseInt(e.target.value) || 0)}
                disabled={saving || !settings.carryover_unused_vacation}
                style={styles.input}
              />
              <span style={styles.description}>
                Maximum vacation hours that can be carried over to the next year
              </span>
            </div>
          </div>

          <div style={styles.warningBox}>
            <strong>Note:</strong> Provincial employment standards may override these settings. Consult with legal counsel to ensure compliance.
          </div>
        </div>
      )}
    </div>
  );
};

export default LeaveAndBenefitsTab;