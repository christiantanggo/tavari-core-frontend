// components/HR/HRSettingsComponents/EmployeeManagementTab.jsx - Employee Management Settings Enhanced with Wage Management
import React, { useState, useCallback, useEffect } from 'react';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../Auth/POSAuthWrapper';
import TavariCheckbox from '../../UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';
import { supabase } from '../../../supabaseClient';
import toast from 'react-hot-toast';
import { Plus, Edit2, Trash2, X } from 'lucide-react';
import PositionSelectWithNew from '../PositionSelectWithNew';
import { filterEmployeesForPermanentRaise } from '../../../helpers/HR/permanentEmployeeRaiseEligibility';

const EmployeeManagementTab = ({
  settings,
  onSettingsChange,
  selectedBusinessId,
  businessData,
  userRole,
  authUser,
  saving
}) => {
  // State for wage adjustment operations
  const [wageAdjustmentType, setWageAdjustmentType] = useState('percentage'); // 'percentage' or 'amount'
  const [wageAdjustmentValue, setWageAdjustmentValue] = useState('');
  const [wageIncreaseEffectiveDate, setWageIncreaseEffectiveDate] = useState(
    () => new Date().toISOString().split('T')[0]
  );
  const [isProcessingWageUpdate, setIsProcessingWageUpdate] = useState(false);
  const [wageUpdateMessage, setWageUpdateMessage] = useState('');

  // State for certificate management
  const [certificates, setCertificates] = useState([]);
  const [loadingCertificates, setLoadingCertificates] = useState(false);
  const [showCertificateForm, setShowCertificateForm] = useState(false);
  const [editingCertificate, setEditingCertificate] = useState(null);
  const [certificateFormData, setCertificateFormData] = useState({
    name: '',
    description: '',
    issuing_authority: '',
    requires_renewal: false,
    renewal_period_months: null,
    enable_notifications: true,
    notify_days_before_expiry: 30,
    notify_on_expiry_date: true,
    notification_recipient_emails: []
  });
  const [notificationEmailInput, setNotificationEmailInput] = useState('');

  // Security context for sensitive employee management settings
  const {
    validateInput,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'EmployeeManagementTab',
    sensitiveComponent: true,
    enableAuditLogging: true,
    securityLevel: 'medium'
  });

  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId);

  // Load certificates on mount
  useEffect(() => {
    if (selectedBusinessId) {
      loadCertificates();
    }
  }, [selectedBusinessId]);

  const loadCertificates = async () => {
    setLoadingCertificates(true);
    try {
      const { data, error } = await supabase
        .from('hr_certificates')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setCertificates(data || []);
    } catch (error) {
      console.error('Error loading certificates:', error);
      toast.error('Failed to load certificates');
    } finally {
      setLoadingCertificates(false);
    }
  };

  const handleSaveCertificate = async () => {
    if (!certificateFormData.name.trim()) {
      toast.error('Certificate name is required');
      return;
    }

    try {
      if (editingCertificate) {
        // Update existing certificate
        const { error } = await supabase
          .from('hr_certificates')
          .update({
            name: certificateFormData.name.trim(),
            description: certificateFormData.description.trim() || null,
            issuing_authority: certificateFormData.issuing_authority.trim() || null,
            requires_renewal: certificateFormData.requires_renewal,
            renewal_period_months: certificateFormData.requires_renewal ? certificateFormData.renewal_period_months : null,
            enable_notifications: certificateFormData.enable_notifications,
            notify_days_before_expiry: certificateFormData.enable_notifications ? certificateFormData.notify_days_before_expiry : null,
            notify_on_expiry_date: certificateFormData.enable_notifications ? certificateFormData.notify_on_expiry_date : false,
            notification_recipient_emails: certificateFormData.enable_notifications ? certificateFormData.notification_recipient_emails : []
          })
          .eq('id', editingCertificate.id);

        if (error) throw error;
        toast.success('Certificate updated successfully');
      } else {
        // Create new certificate
        const { error } = await supabase
          .from('hr_certificates')
          .insert({
            business_id: selectedBusinessId,
            name: certificateFormData.name.trim(),
            description: certificateFormData.description.trim() || null,
            issuing_authority: certificateFormData.issuing_authority.trim() || null,
            requires_renewal: certificateFormData.requires_renewal,
            renewal_period_months: certificateFormData.requires_renewal ? certificateFormData.renewal_period_months : null,
            enable_notifications: certificateFormData.enable_notifications,
            notify_days_before_expiry: certificateFormData.enable_notifications ? certificateFormData.notify_days_before_expiry : null,
            notify_on_expiry_date: certificateFormData.enable_notifications ? certificateFormData.notify_on_expiry_date : false,
            notification_recipient_emails: certificateFormData.enable_notifications ? certificateFormData.notification_recipient_emails : [],
            is_active: true
          });

        if (error) throw error;
        toast.success('Certificate created successfully');
      }

      setShowCertificateForm(false);
      setEditingCertificate(null);
      setCertificateFormData({
        name: '',
        description: '',
        issuing_authority: '',
        requires_renewal: false,
        renewal_period_months: null,
        enable_notifications: true,
        notify_days_before_expiry: 30,
        notify_on_expiry_date: true,
        notification_recipient_emails: []
      });
      setNotificationEmailInput('');
      await loadCertificates();
    } catch (error) {
      console.error('Error saving certificate:', error);
      toast.error('Failed to save certificate: ' + (error.message || 'Unknown error'));
    }
  };

  const handleEditCertificate = (cert) => {
    setEditingCertificate(cert);
    setCertificateFormData({
      name: cert.name || '',
      description: cert.description || '',
      issuing_authority: cert.issuing_authority || '',
      requires_renewal: cert.requires_renewal || false,
      renewal_period_months: cert.renewal_period_months || null,
      enable_notifications: cert.enable_notifications !== false,
      notify_days_before_expiry: cert.notify_days_before_expiry || 30,
      notify_on_expiry_date: cert.notify_on_expiry_date !== false,
      notification_recipient_emails: cert.notification_recipient_emails || []
    });
    setNotificationEmailInput('');
    setShowCertificateForm(true);
  };

  const handleDeleteCertificate = async (cert) => {
    if (!confirm(`Are you sure you want to delete "${cert.name}"? This will not delete existing employee certificate assignments.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('hr_certificates')
        .update({ is_active: false })
        .eq('id', cert.id);

      if (error) throw error;
      toast.success('Certificate deleted successfully');
      await loadCertificates();
    } catch (error) {
      console.error('Error deleting certificate:', error);
      toast.error('Failed to delete certificate: ' + (error.message || 'Unknown error'));
    }
  };

  const handleInputChange = async (field, value) => {
    await logSecurityEvent('employee_settings_change', {
      field,
      new_value: typeof value === 'boolean' ? value : 'redacted',
      business_id: selectedBusinessId
    }, 'low');

    onSettingsChange(field, value);
  };

  // Handle wage updates that affect all employees
  const handleWageUpdate = useCallback(async (updateType) => {
    if (isProcessingWageUpdate) return;
    
    try {
      setIsProcessingWageUpdate(true);
      setWageUpdateMessage('');

      // Get all employees for this business - EXCLUDE terminated employees
      const { data: employees, error: employeesError } = await supabase
        .from('users')
        .select(`
          id, wage, first_name, last_name, full_name, email, is_student, birth_date,
          employment_status, hire_date, probation_end_date,
          business_users!inner(business_id, employment_status)
        `)
        .eq('business_users.business_id', selectedBusinessId)
        .neq('employment_status', 'terminated')
        .not('wage', 'is', null)
        .order('employment_status', { ascending: true });

      if (employeesError) {
        console.error('Database error:', employeesError);
        throw new Error(`Database error: ${employeesError.message}`);
      }

      console.log('DEBUG: Raw employee data from database:', employees);
      console.log('DEBUG: Number of employees found:', employees?.length || 0);
      
      if (!employees || employees.length === 0) {
        setWageUpdateMessage('No employees found for this business.');
        return;
      }

      // Skip employees terminated on business_users even if users.employment_status differs
      const activeEmployees = employees.filter((emp) => {
        const bu = Array.isArray(emp.business_users) ? emp.business_users[0] : emp.business_users;
        return String(bu?.employment_status || '').toLowerCase() !== 'terminated';
      });

      let targetEmployees = activeEmployees;

      const effectiveDate = String(wageIncreaseEffectiveDate || '').trim().slice(0, 10);
      const today = new Date().toISOString().split('T')[0];
      const applyProfileWageNow = !!effectiveDate && effectiveDate <= today;

      if (
        (updateType === 'increase_all_wages' || updateType === 'increase_permanent_wages') &&
        !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)
      ) {
        throw new Error('Please select a valid raise effective date (YYYY-MM-DD).');
      }

      if (updateType === 'increase_permanent_wages') {
        const { data: contracts, error: contractsError } = await supabase
          .from('hr_contracts')
          .select('id, employee_id, status, contract_type, start_date, end_date, contract_data')
          .eq('business_id', selectedBusinessId)
          .eq('status', 'signed');

        if (contractsError) {
          console.error('Contracts load error:', contractsError);
          throw new Error(`Could not load contracts: ${contractsError.message}`);
        }

        targetEmployees = filterEmployeesForPermanentRaise(activeEmployees, contracts || []);

        if (targetEmployees.length === 0) {
          setWageUpdateMessage(
            'No permanent employees qualify for this raise (past probation and not on an active seasonal/contract term).'
          );
          return;
        }

        const names = targetEmployees
          .map((e) => e.full_name || `${e.first_name || ''} ${e.last_name || ''}`.trim())
          .filter(Boolean);
        const excludedCount = activeEmployees.length - targetEmployees.length;
        const confirmed = window.confirm(
          `Apply wage increase effective ${effectiveDate} to ${targetEmployees.length} permanent employee(s)?\n\n` +
            `${names.map((n) => `• ${n}`).join('\n')}\n\n` +
            (excludedCount > 0
              ? `${excludedCount} active employee(s) excluded (probation and/or active seasonal/contract).\n\n`
              : '') +
            (applyProfileWageNow
              ? 'Profile wages will update now (effective date is today or earlier).\n\n'
              : 'Effective date is in the future — wage history will be recorded, profile wages stay unchanged until that date.\n\n') +
            'This cannot be undone automatically.'
        );
        if (!confirmed) {
          setWageUpdateMessage('Permanent wage increase cancelled.');
          return;
        }
      }

      let updatedEmployees = [];
      const regularMinWage = parseFloat(settings.minimum_wage_regular) || 0;
      const studentMinWage = parseFloat(settings.minimum_wage_student) || regularMinWage;

      console.log('DEBUG: Minimum wages - Regular:', regularMinWage, 'Student:', studentMinWage);
      console.log('DEBUG: Update type:', updateType);

      switch (updateType) {
        case 'update_to_minimum':
          // Update employees to minimum wage (assume all regular employees for now)
          console.log('DEBUG: Processing update_to_minimum for', targetEmployees.length, 'employees');
          
          for (const employee of targetEmployees) {
            const currentWage = parseFloat(employee.wage) || 0;
            const applicableMinWage = regularMinWage; // Simplified - use regular min wage for all
            
            console.log(`DEBUG: ${employee.full_name} (${employee.employment_status}) - Current: $${currentWage}, Min: $${applicableMinWage}`);
            
            if (currentWage < applicableMinWage) {
              console.log(`DEBUG: UPDATING ${employee.full_name} from $${currentWage} to $${applicableMinWage}`);
              
              // Simple update without audit fields to avoid constraint issues
              const { error } = await supabase
                .from('users')
                .update({ 
                  wage: applicableMinWage
                })
                .eq('id', employee.id);

              if (!error) {
                updatedEmployees.push({
                  name: employee.full_name || `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Unknown Employee',
                  old_wage: currentWage,
                  new_wage: applicableMinWage,
                  type: 'Regular',
                  status: employee.employment_status || 'unknown'
                });
                console.log(`SUCCESS: Updated ${employee.full_name} wage to $${applicableMinWage}`);
              } else {
                console.error(`ERROR updating ${employee.full_name}:`, error);
              }
            } else {
              console.log(`DEBUG: SKIPPING ${employee.full_name} - already at/above minimum`);
            }
          }
          break;

        case 'increase_all_wages':
        case 'increase_permanent_wages': {
          // Increase wages by specified amount or percentage (all vs permanent-eligible)
          const adjustmentValue = parseFloat(wageAdjustmentValue) || 0;
          if (adjustmentValue === 0) {
            throw new Error('Please enter a valid adjustment amount (can be negative to decrease wages)');
          }

          const wageHistoryRecords = [];
          const changeType =
            updateType === 'increase_permanent_wages'
              ? 'permanent_employee_increase'
              : 'bulk_increase';
          const reasonLabel =
            updateType === 'increase_permanent_wages'
              ? `Permanent employee ${wageAdjustmentType} raise`
              : `Bulk ${wageAdjustmentType} increase`;

          for (const employee of targetEmployees) {
            const currentWage = parseFloat(employee.wage) || 0;
            let newWage;

            if (wageAdjustmentType === 'percentage') {
              newWage = currentWage * (1 + adjustmentValue / 100);
            } else {
              newWage = currentWage + adjustmentValue;
            }

            // Ensure new wage meets minimum wage requirements (use regular minimum for all)
            const applicableMinWage = regularMinWage;
            newWage = Math.max(newWage, applicableMinWage);
            newWage = Math.round(newWage * 100) / 100;

            if (Math.abs(newWage - currentWage) > 0.01) {
              wageHistoryRecords.push({
                user_id: employee.id,
                business_id: selectedBusinessId,
                previous_wage: currentWage,
                new_wage: newWage,
                effective_date: effectiveDate,
                reason: reasonLabel,
                change_type: changeType,
                created_by: authUser?.id || null,
                _employee: employee,
              });
            }
          }

          if (wageHistoryRecords.length > 0) {
            const rowsForInsert = wageHistoryRecords.map(({ _employee, ...row }) => row);
            const { error: historyError } = await supabase
              .from('hrpayroll_wage_history')
              .insert(rowsForInsert);

            if (historyError) {
              throw new Error(`Failed to save wage history: ${historyError.message}`);
            }

            for (const record of wageHistoryRecords) {
              const employee = record._employee;
              if (applyProfileWageNow) {
                const { error } = await supabase
                  .from('users')
                  .update({ wage: record.new_wage })
                  .eq('id', employee.id);

                if (error) {
                  console.error('Error updating employee wage:', error);
                }
              }

              updatedEmployees.push({
                name: employee.full_name || `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Unknown Employee',
                old_wage: record.previous_wage,
                new_wage: record.new_wage,
                type: updateType === 'increase_permanent_wages' ? 'Permanent' : 'Regular',
                status: employee.employment_status || 'unknown'
              });
              console.log(
                `SUCCESS: Recorded ${employee.full_name} wage ${record.previous_wage} → ${record.new_wage} effective ${effectiveDate}`
              );
            }
          }
          break;
        }
      }

      // Simple success message without security logging
      if (updatedEmployees.length > 0) {
        const effectiveNote =
          updateType === 'increase_all_wages' || updateType === 'increase_permanent_wages'
            ? ` (effective ${effectiveDate}${applyProfileWageNow ? ', profile wages updated' : ', profile wages unchanged until effective date'})`
            : '';
        setWageUpdateMessage(`Successfully updated wages for ${updatedEmployees.length} employee(s)${effectiveNote}:\n` +
          updatedEmployees.map(emp => 
            `• ${emp.name} (${emp.status}): $${formatTaxAmount ? formatTaxAmount(emp.old_wage) : emp.old_wage.toFixed(2)}/hr → $${formatTaxAmount ? formatTaxAmount(emp.new_wage) : emp.new_wage.toFixed(2)}/hr`
          ).join('\n'));
      } else {
        setWageUpdateMessage('No employees required wage updates.');
      }

    } catch (error) {
      console.error('Wage update error:', error);
      setWageUpdateMessage(`Error updating wages: ${error.message}`);
    } finally {
      setIsProcessingWageUpdate(false);
    }
  }, [
    selectedBusinessId,
    userRole,
    authUser,
    settings,
    wageAdjustmentType,
    wageAdjustmentValue,
    wageIncreaseEffectiveDate,
    formatTaxAmount,
    isProcessingWageUpdate,
  ]);

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
    fullWidth: {
      gridColumn: '1 / -1'
    },
    inputGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    label: {
      ...TavariStyles.components.form?.label || {
        fontSize: TavariStyles.typography.fontSize.sm,
        fontWeight: TavariStyles.typography.fontWeight.medium,
        color: TavariStyles.colors.gray700,
        marginBottom: TavariStyles.spacing.sm,
        display: 'block'
      }
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
    helpText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      fontStyle: 'italic',
      marginTop: TavariStyles.spacing.xs
    },
    wageSection: {
      backgroundColor: `linear-gradient(135deg, ${TavariStyles.colors.primary}08 0%, ${TavariStyles.colors.white} 100%)`,
      border: `2px solid ${TavariStyles.colors.primary}20`
    },
    buttonGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      flexWrap: 'wrap',
      alignItems: 'center'
    },
    button: {
      ...TavariStyles.components.button?.base || {
        padding: '12px 20px',
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        border: 'none',
        fontSize: TavariStyles.typography.fontSize.sm,
        fontWeight: TavariStyles.typography.fontWeight.semibold,
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      },
      ...TavariStyles.components.button?.variants?.primary || {
        backgroundColor: TavariStyles.colors.primary,
        color: TavariStyles.colors.white
      }
    },
    dangerButton: {
      ...TavariStyles.components.button?.base || {
        padding: '12px 20px',
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        border: 'none',
        fontSize: TavariStyles.typography.fontSize.sm,
        fontWeight: TavariStyles.typography.fontWeight.semibold,
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      },
      backgroundColor: TavariStyles.colors.warning,
      color: TavariStyles.colors.white
    },
    secondaryButton: {
      ...TavariStyles.components.button?.base || {
        padding: '12px 20px',
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        fontSize: TavariStyles.typography.fontSize.sm,
        fontWeight: TavariStyles.typography.fontWeight.semibold,
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      },
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.primary,
      border: `1px solid ${TavariStyles.colors.primary}`
    },
    disabledButton: {
      opacity: 0.6,
      cursor: 'not-allowed'
    },
    radioGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.lg,
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.md
    },
    radioOption: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      cursor: 'pointer'
    },
    messageBox: {
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginTop: TavariStyles.spacing.md,
      whiteSpace: 'pre-line',
      fontFamily: 'monospace',
      fontSize: TavariStyles.typography.fontSize.xs,
      backgroundColor: TavariStyles.colors.gray50,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    warningBox: {
      backgroundColor: TavariStyles.colors.warning + '10',
      border: `1px solid ${TavariStyles.colors.warning}`,
      color: TavariStyles.colors.warning,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium
    }
  };

  return (
    <div style={styles.container}>
      {/* Basic Employee Configuration */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Basic Employee Configuration</h3>
        
        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Probation Period (days)
            </label>
            <input
              type="number"
              min="0"
              max="365"
              value={settings.probation_period_days || 90}
              onChange={(e) => handleInputChange('probation_period_days', parseInt(e.target.value) || 0)}
              disabled={saving}
              style={styles.input}
            />
            <span style={styles.description}>
              Default probation period for new employees
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Employee Number Prefix
            </label>
            <input
              type="text"
              maxLength="10"
              value={settings.employee_number_prefix || 'EMP'}
              onChange={(e) => handleInputChange('employee_number_prefix', e.target.value)}
              disabled={saving}
              style={styles.input}
              placeholder="EMP"
            />
            <span style={styles.description}>
              Prefix for auto-generated employee numbers (e.g., EMP001, EMP002)
            </span>
          </div>
        </div>
      </div>

      {/* Wage Management Section */}
      <div style={{ ...styles.section, ...styles.wageSection }}>
        <h3 style={styles.sectionTitle}>Wage Management & Minimum Wage Settings</h3>
        
        <div style={styles.warningBox}>
          Important: Wage changes affect all employees and are permanently logged for audit purposes. Ensure you have proper authorization before making changes.
        </div>

        {/* Minimum Wage Settings */}
        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Regular Minimum Wage ($/hour)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={settings.minimum_wage_regular || ''}
              onChange={(e) => handleInputChange('minimum_wage_regular', parseFloat(e.target.value) || 0)}
              disabled={saving}
              style={styles.input}
              placeholder="17.20"
            />
            <span style={styles.description}>
              Minimum wage for regular employees (Ontario: $17.20/hr as of Oct 2024)
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Student Minimum Wage ($/hour)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={settings.minimum_wage_student || ''}
              onChange={(e) => handleInputChange('minimum_wage_student', parseFloat(e.target.value) || 0)}
              disabled={saving}
              style={styles.input}
              placeholder="16.20"
            />
            <span style={styles.description}>
              Minimum wage for students under 18 or working less than 28 hours/week (Ontario: $16.20/hr)
            </span>
          </div>
        </div>

        {/* Bulk Wage Update Actions */}
        <div style={styles.fullWidth}>
          <h4 style={{ ...styles.sectionTitle, fontSize: TavariStyles.typography.fontSize.lg, marginTop: TavariStyles.spacing.xl }}>
            Bulk Wage Update Actions
          </h4>

          {/* Update to Minimum Wage */}
          <div style={styles.inputGroup}>
            <label style={styles.label}>Update All Employees to Meet Minimum Wage</label>
            <div style={styles.buttonGroup}>
              <button
                style={{
                  ...styles.button,
                  ...(isProcessingWageUpdate ? styles.disabledButton : {})
                }}
                onClick={() => handleWageUpdate('update_to_minimum')}
                disabled={saving || isProcessingWageUpdate}
              >
                {isProcessingWageUpdate ? 'Updating Wages...' : 'Update to Minimum Wage'}
              </button>
            </div>
            <span style={styles.description}>
              Updates all employees earning below minimum wage to their applicable minimum wage (regular or student rate)
            </span>
          </div>

          {/* Increase All Wages */}
          <div style={styles.inputGroup}>
            <label style={styles.label}>Increase All Employee Wages</label>
            
            <div style={styles.radioGroup}>
              <label style={styles.radioOption}>
                <input
                  type="radio"
                  name="wageAdjustmentType"
                  value="percentage"
                  checked={wageAdjustmentType === 'percentage'}
                  onChange={(e) => setWageAdjustmentType(e.target.value)}
                  disabled={saving || isProcessingWageUpdate}
                />
                <span>Percentage Increase (%)</span>
              </label>
              <label style={styles.radioOption}>
                <input
                  type="radio"
                  name="wageAdjustmentType"
                  value="amount"
                  checked={wageAdjustmentType === 'amount'}
                  onChange={(e) => setWageAdjustmentType(e.target.value)}
                  disabled={saving || isProcessingWageUpdate}
                />
                <span>Dollar Amount Increase ($)</span>
              </label>
            </div>

            <div style={{ ...styles.buttonGroup, marginBottom: TavariStyles.spacing.md }}>
              <label style={{ ...styles.label, marginBottom: 0, whiteSpace: 'nowrap' }}>
                Raise effective date
              </label>
              <input
                type="date"
                value={wageIncreaseEffectiveDate}
                onChange={(e) => setWageIncreaseEffectiveDate(e.target.value)}
                disabled={saving || isProcessingWageUpdate}
                style={{ ...styles.input, width: '180px' }}
              />
            </div>

            <div style={styles.buttonGroup}>
              <input
                type="number"
                min="-100"
                step={wageAdjustmentType === 'percentage' ? '0.1' : '0.01'}
                value={wageAdjustmentValue}
                onChange={(e) => setWageAdjustmentValue(e.target.value)}
                disabled={saving || isProcessingWageUpdate}
                style={{ ...styles.input, width: '120px' }}
                placeholder={wageAdjustmentType === 'percentage' ? '5.0' : '1.00'}
              />
              <span style={styles.label}>
                {wageAdjustmentType === 'percentage' ? '%' : '$/hour'}
              </span>
              <button
                style={{
                  ...styles.dangerButton,
                  ...(isProcessingWageUpdate || !wageAdjustmentValue || !wageIncreaseEffectiveDate
                    ? styles.disabledButton
                    : {})
                }}
                onClick={() => handleWageUpdate('increase_all_wages')}
                disabled={
                  saving ||
                  isProcessingWageUpdate ||
                  !wageAdjustmentValue ||
                  !wageIncreaseEffectiveDate
                }
              >
                {isProcessingWageUpdate ? 'Applying Increase...' : 'Apply Wage Increase to All'}
              </button>
              <button
                style={{
                  ...styles.button,
                  ...(isProcessingWageUpdate || !wageAdjustmentValue || !wageIncreaseEffectiveDate
                    ? styles.disabledButton
                    : {}),
                  backgroundColor: '#0f766e',
                  color: '#ffffff',
                  border: 'none'
                }}
                onClick={() => handleWageUpdate('increase_permanent_wages')}
                disabled={
                  saving ||
                  isProcessingWageUpdate ||
                  !wageAdjustmentValue ||
                  !wageIncreaseEffectiveDate
                }
              >
                {isProcessingWageUpdate ? 'Applying Increase...' : 'Apply Raise to Permanent Employees'}
              </button>
            </div>
            
            <span style={styles.description}>
              {wageAdjustmentType === 'percentage' 
                ? 'Increases employee wages by the specified percentage. Wages will be adjusted to meet minimum wage requirements if necessary.'
                : 'Increases employee wages by the specified dollar amount per hour. Use negative values to decrease wages. Wages will be adjusted to meet minimum wage requirements if necessary.'}
            </span>
            <span style={styles.description}>
              Set <strong>Raise effective date</strong> for when the new rate starts (e.g. 2026-07-05).
              Payroll uses wage history by that date; if the date is today or earlier, current profile wages update too.
            </span>
            <span style={styles.description}>
              <strong>Apply Raise to Permanent Employees</strong> only includes staff past their 3-month probation
              (hire date + 90 days) who are not currently on an active seasonal/temporary contract.
              Staff whose contract end date has already passed remain eligible.
            </span>
          </div>

          {wageUpdateMessage && (
            <div style={styles.messageBox}>
              {wageUpdateMessage}
            </div>
          )}
        </div>
      </div>

      {/* Employee Number Generation */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Employee Number Generation</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.auto_generate_employee_numbers ?? true}
              onChange={(checked) => handleInputChange('auto_generate_employee_numbers', checked)}
              label="Auto-generate employee numbers"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Automatically assign sequential employee numbers when creating new employees
            </span>
          </div>
        </div>
      </div>

      {/* Employee Profile Management */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Employee Profile Management</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.allow_employee_self_edit ?? true}
              onChange={(checked) => handleInputChange('allow_employee_self_edit', checked)}
              label="Allow employees to edit their own profiles"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Employees can update their contact information, emergency contacts, and other personal details
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_manager_approval_profile_changes ?? false}
              onChange={(checked) => handleInputChange('require_manager_approval_profile_changes', checked)}
              label="Require manager approval for profile changes"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              All employee profile changes must be reviewed and approved by a manager before taking effect
            </span>
          </div>
        </div>
      </div>

      {/* Department and Role Management */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Department and Role Management</h3>
        
        <div style={styles.grid}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Default Department
            </label>
            <input
              type="text"
              maxLength="50"
              value={settings.default_department || ''}
              onChange={(e) => handleInputChange('default_department', e.target.value)}
              disabled={saving}
              style={styles.input}
              placeholder="General"
            />
            <span style={styles.description}>
              Default department for new employees
            </span>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>
              Default Job Title
            </label>
            <PositionSelectWithNew
              businessId={selectedBusinessId}
              value={settings.default_job_title || ''}
              onChange={(v) => handleInputChange('default_job_title', v)}
              disabled={saving}
              selectStyle={{ ...styles.input, width: '100%', maxWidth: '420px' }}
            />
            <span style={styles.description}>
              Default job title for new employees (managed in Position Management)
            </span>
          </div>
        </div>
      </div>

      {/* Emergency Contact Requirements */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Emergency Contact Requirements</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_emergency_contact ?? true}
              onChange={(checked) => handleInputChange('require_emergency_contact', checked)}
              label="Require emergency contact information"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              All employees must provide at least one emergency contact
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_multiple_emergency_contacts ?? false}
              onChange={(checked) => handleInputChange('require_multiple_emergency_contacts', checked)}
              label="Require multiple emergency contacts"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Employees must provide at least two emergency contacts
            </span>
          </div>
        </div>
      </div>

      {/* Photo and Identification */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Photo and Identification</h3>
        
        <div style={styles.toggleGroup}>
          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.require_employee_photo ?? false}
              onChange={(checked) => handleInputChange('require_employee_photo', checked)}
              label="Require employee photos"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              All employees must upload a profile photo
            </span>
          </div>

          <div style={styles.toggleItem}>
            <TavariCheckbox
              checked={settings.allow_photo_updates ?? true}
              onChange={(checked) => handleInputChange('allow_photo_updates', checked)}
              label="Allow employees to update their photos"
              disabled={saving}
              size="md"
            />
            <span style={styles.description}>
              Employees can update their profile photos themselves
            </span>
          </div>
        </div>
      </div>

      {/* Certificate Management */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Certificate Types Management</h3>
        <span style={styles.description}>
          Create and manage certificate types that can be assigned to employees (e.g., First Aid, Food Safety, etc.)
        </span>

        {!showCertificateForm && (
          <div style={{ marginTop: TavariStyles.spacing.lg }}>
            <button
              type="button"
              onClick={() => {
                setEditingCertificate(null);
                setCertificateFormData({
                  name: '',
                  description: '',
                  issuing_authority: '',
                  requires_renewal: false,
                  renewal_period_months: null
                });
                setShowCertificateForm(true);
              }}
              style={styles.button}
            >
              <Plus size={16} style={{ marginRight: '8px' }} />
              Add Certificate Type
            </button>

            {loadingCertificates ? (
              <div style={{ marginTop: TavariStyles.spacing.md, color: TavariStyles.colors.gray500 }}>
                Loading certificates...
              </div>
            ) : certificates.length === 0 ? (
              <div style={{ marginTop: TavariStyles.spacing.md, color: TavariStyles.colors.gray500 }}>
                No certificate types created yet. Click "Add Certificate Type" to create one.
              </div>
            ) : (
              <div style={{ marginTop: TavariStyles.spacing.lg }}>
                {certificates.map((cert) => (
                  <div
                    key={cert.id}
                    style={{
                      padding: TavariStyles.spacing.md,
                      border: `1px solid ${TavariStyles.colors.gray200}`,
                      borderRadius: TavariStyles.borderRadius?.md || '6px',
                      marginBottom: TavariStyles.spacing.md,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: '600', marginBottom: '4px' }}>{cert.name}</div>
                      {cert.issuing_authority && (
                        <div style={{ fontSize: '10px', color: TavariStyles.colors.gray600 }}>
                          Issuing Authority: {cert.issuing_authority}
                        </div>
                      )}
                      {cert.requires_renewal && cert.renewal_period_months && (
                        <div style={{ fontSize: '10px', color: TavariStyles.colors.gray600 }}>
                          Renewal Period: {cert.renewal_period_months} months
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => handleEditCertificate(cert)}
                        style={{
                          ...styles.secondaryButton,
                          padding: '6px 12px',
                          fontSize: '10px'
                        }}
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCertificate(cert)}
                        style={{
                          ...styles.dangerButton,
                          padding: '6px 12px',
                          fontSize: '10px'
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showCertificateForm && (
          <div style={{
            marginTop: TavariStyles.spacing.lg,
            padding: TavariStyles.spacing.lg,
            border: `2px solid ${TavariStyles.colors.primary}`,
            borderRadius: TavariStyles.borderRadius?.md || '6px',
            backgroundColor: TavariStyles.colors.gray50
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: TavariStyles.spacing.md }}>
              <h4 style={{ margin: 0 }}>
                {editingCertificate ? 'Edit Certificate Type' : 'Add Certificate Type'}
              </h4>
              <button
                type="button"
                onClick={() => {
                  setShowCertificateForm(false);
                  setEditingCertificate(null);
                  setCertificateFormData({
                    name: '',
                    description: '',
                    issuing_authority: '',
                    requires_renewal: false,
                    renewal_period_months: null
                  });
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Certificate Name *</label>
              <input
                type="text"
                value={certificateFormData.name}
                onChange={(e) => setCertificateFormData(prev => ({ ...prev, name: e.target.value }))}
                style={styles.input}
                placeholder="e.g., First Aid, Food Safety, WHMIS"
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Issuing Authority</label>
              <input
                type="text"
                value={certificateFormData.issuing_authority}
                onChange={(e) => setCertificateFormData(prev => ({ ...prev, issuing_authority: e.target.value }))}
                style={styles.input}
                placeholder="e.g., Red Cross, Public Health, WSIB"
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Description</label>
              <textarea
                value={certificateFormData.description}
                onChange={(e) => setCertificateFormData(prev => ({ ...prev, description: e.target.value }))}
                style={{ ...styles.input, minHeight: '80px' }}
                placeholder="Optional description of this certificate"
              />
            </div>

            <div style={styles.toggleItem}>
              <TavariCheckbox
                checked={certificateFormData.requires_renewal}
                onChange={(checked) => setCertificateFormData(prev => ({ ...prev, requires_renewal: checked }))}
                label="Requires Renewal"
                size="md"
              />
            </div>

            {certificateFormData.requires_renewal && (
              <div style={styles.inputGroup}>
                <label style={styles.label}>Renewal Period (months)</label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={certificateFormData.renewal_period_months || ''}
                  onChange={(e) => setCertificateFormData(prev => ({ ...prev, renewal_period_months: parseInt(e.target.value) || null }))}
                  style={styles.input}
                  placeholder="e.g., 36 for 3 years"
                />
              </div>
            )}

            {/* Expiration Notification Settings */}
            <div style={{ 
              marginTop: TavariStyles.spacing.xl, 
              padding: TavariStyles.spacing.lg, 
              backgroundColor: TavariStyles.colors.blue50 || '#f0f7ff',
              borderRadius: TavariStyles.borderRadius?.md || '6px',
              border: `1px solid ${TavariStyles.colors.blue200 || '#bfdbfe'}`
            }}>
              <h5 style={{ 
                marginTop: 0, 
                marginBottom: TavariStyles.spacing.md,
                fontSize: TavariStyles.typography.fontSize.md,
                fontWeight: TavariStyles.typography.fontWeight.semibold,
                color: TavariStyles.colors.gray800
              }}>
                Expiration Notification Settings
              </h5>
              <span style={{ 
                fontSize: TavariStyles.typography.fontSize.sm,
                color: TavariStyles.colors.gray600,
                display: 'block',
                marginBottom: TavariStyles.spacing.md
              }}>
                Configure when and to whom expiration reminder emails are sent. Important for payroll compliance.
              </span>

              <div style={styles.toggleItem}>
                <TavariCheckbox
                  checked={certificateFormData.enable_notifications}
                  onChange={(checked) => setCertificateFormData(prev => ({ ...prev, enable_notifications: checked }))}
                  label="Enable Expiration Notifications"
                  size="md"
                />
              </div>

              {certificateFormData.enable_notifications && (
                <>
                  <div style={styles.inputGroup}>
                    <label style={styles.label}>
                      Notify When Certificate Expires In (Days)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={certificateFormData.notify_days_before_expiry || ''}
                      onChange={(e) => setCertificateFormData(prev => ({ 
                        ...prev, 
                        notify_days_before_expiry: parseInt(e.target.value) || 30 
                      }))}
                      style={styles.input}
                      placeholder="e.g., 30 for 30 days before expiration"
                    />
                    <span style={{ 
                      fontSize: TavariStyles.typography.fontSize.xs,
                      color: TavariStyles.colors.gray500,
                      marginTop: '4px',
                      display: 'block'
                    }}>
                      System will send notification email when certificate has less than this many days remaining
                    </span>
                  </div>

                  <div style={styles.toggleItem}>
                    <TavariCheckbox
                      checked={certificateFormData.notify_on_expiry_date}
                      onChange={(checked) => setCertificateFormData(prev => ({ ...prev, notify_on_expiry_date: checked }))}
                      label="Send Reminder Email on Expiration Date"
                      size="md"
                    />
                  </div>

                  <div style={styles.inputGroup}>
                    <label style={styles.label}>
                      Additional Notification Recipients
                    </label>
                    <span style={{ 
                      fontSize: TavariStyles.typography.fontSize.xs,
                      color: TavariStyles.colors.gray500,
                      marginBottom: '8px',
                      display: 'block'
                    }}>
                      Email addresses to notify in addition to the employee (e.g., HR manager, payroll). Enter multiple emails separated by commas, or press Enter to add each email individually.
                    </span>
                    <div style={{ display: 'flex', gap: TavariStyles.spacing.sm, marginBottom: TavariStyles.spacing.sm }}>
                      <input
                        type="text"
                        value={notificationEmailInput}
                        onChange={(e) => setNotificationEmailInput(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' && notificationEmailInput.trim()) {
                            e.preventDefault();
                            // Support comma-separated emails (like pay statements)
                            const emails = notificationEmailInput
                              .split(',')
                              .map(email => email.trim().toLowerCase())
                              .filter(email => email.includes('@') && email.length > 0);
                            
                            const newEmails = emails.filter(email => 
                              !certificateFormData.notification_recipient_emails.includes(email)
                            );
                            
                            if (newEmails.length > 0) {
                              setCertificateFormData(prev => ({
                                ...prev,
                                notification_recipient_emails: [...prev.notification_recipient_emails, ...newEmails]
                              }));
                              setNotificationEmailInput('');
                            }
                          }
                        }}
                        style={styles.input}
                        placeholder="Enter email(s) separated by commas, or press Enter to add"
                      />
                    </div>
                    {certificateFormData.notification_recipient_emails.length > 0 && (
                      <div style={{ 
                        display: 'flex', 
                        flexWrap: 'wrap', 
                        gap: TavariStyles.spacing.xs,
                        marginTop: TavariStyles.spacing.sm
                      }}>
                        {certificateFormData.notification_recipient_emails.map((email, index) => (
                          <span
                            key={index}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: TavariStyles.spacing.xs,
                              padding: '4px 8px',
                              backgroundColor: TavariStyles.colors.primary || '#3b82f6',
                              color: 'white',
                              borderRadius: TavariStyles.borderRadius?.sm || '4px',
                              fontSize: TavariStyles.typography.fontSize.sm
                            }}
                          >
                            {email}
                            <button
                              type="button"
                              onClick={() => {
                                setCertificateFormData(prev => ({
                                  ...prev,
                                  notification_recipient_emails: prev.notification_recipient_emails.filter((_, i) => i !== index)
                                }));
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'white',
                                cursor: 'pointer',
                                padding: 0,
                                marginLeft: '4px',
                                fontSize: '11px',
                                lineHeight: 1
                              }}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: TavariStyles.spacing.md, marginTop: TavariStyles.spacing.lg }}>
              <button
                type="button"
                onClick={handleSaveCertificate}
                style={styles.button}
              >
                {editingCertificate ? 'Update Certificate' : 'Create Certificate'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCertificateForm(false);
                  setEditingCertificate(null);
                  setCertificateFormData({
                    name: '',
                    description: '',
                    issuing_authority: '',
                    requires_renewal: false,
                    renewal_period_months: null
                  });
                }}
                style={styles.secondaryButton}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmployeeManagementTab;