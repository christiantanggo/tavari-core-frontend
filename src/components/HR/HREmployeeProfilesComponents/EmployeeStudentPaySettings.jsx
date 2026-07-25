// components/HR/HREmployeeProfilesComponents/EmployeeStudentPaySettings.jsx - Student Pay Management Modal
import React, { useState, useEffect } from 'react';
import { X, GraduationCap, AlertCircle, Save, Info, DollarSign, Clock } from 'lucide-react';
import { supabase } from '../../../supabaseClient';
import { TavariStyles } from '../../../utils/TavariStyles';
import PositionLabel from '../PositionLabel';

const EmployeeStudentPaySettings = ({
  isOpen,
  onClose,
  employee,
  businessId,
  businessSettings,
  authUser,
  onStudentPayUpdated
}) => {
  const [studentPayEnabled, setStudentPayEnabled] = useState(false);
  const [originalStudentPayEnabled, setOriginalStudentPayEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [businessStudentPayEnabled, setBusinessStudentPayEnabled] = useState(true);
  const [loadingBusinessSettings, setLoadingBusinessSettings] = useState(true);

  // Load current settings when modal opens
  useEffect(() => {
    if (isOpen && employee) {
      setStudentPayEnabled(employee.student_pay_enabled || false);
      setOriginalStudentPayEnabled(employee.student_pay_enabled || false);
      setError('');
      loadBusinessStudentPaySettings();
    }
  }, [isOpen, employee]);

  // Load business-level student pay settings
  const loadBusinessStudentPaySettings = async () => {
    try {
      setLoadingBusinessSettings(true);
      
      // Check if business has student pay enabled in settings
      const { data: settings, error: settingsError } = await supabase
        .from('hr_settings') // Assuming you have business settings table
        .select('student_pay_enabled')
        .eq('business_id', businessId)
        .single();

      if (settingsError && settingsError.code !== 'PGRST116') {
        console.error('Error loading business settings:', settingsError);
        // Default to enabled if settings don't exist
        setBusinessStudentPayEnabled(true);
      } else {
        setBusinessStudentPayEnabled(settings?.student_pay_enabled !== false);
      }
    } catch (err) {
      console.error('Error loading business student pay settings:', err);
      setBusinessStudentPayEnabled(true); // Default to enabled
    } finally {
      setLoadingBusinessSettings(false);
    }
  };

  // Calculate age from birth date
  const calculateAge = (birthDate) => {
    if (!birthDate) return null;
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  };

  // Check if employee is eligible for student pay
  const getStudentEligibility = () => {
    const age = calculateAge(employee?.birth_date);
    const isUnder18 = age !== null && age < 18;
    const hasValidBirthDate = employee?.birth_date !== null;
    
    return {
      age,
      isUnder18,
      hasValidBirthDate,
      isEligible: isUnder18 && hasValidBirthDate,
      reason: !hasValidBirthDate 
        ? 'Birth date not set' 
        : !isUnder18 
        ? 'Employee is 18 or older' 
        : null
    };
  };

  // Get wage impact information
  const getWageImpact = () => {
    const regularMinWage = parseFloat(businessSettings?.minimum_wage_regular) || 17.20;
    const studentMinWage = parseFloat(businessSettings?.minimum_wage_student) || 16.20;
    const currentWage = parseFloat(employee?.wage) || 0;
    
    return {
      regularMinWage,
      studentMinWage,
      currentWage,
      difference: regularMinWage - studentMinWage,
      wouldAffectWage: currentWage <= Math.max(regularMinWage, studentMinWage)
    };
  };

  const handleSave = async () => {
    if (!employee) return;
    
    const eligibility = getStudentEligibility();
    
    // Warn if enabling student pay for ineligible employee
    if (studentPayEnabled && !eligibility.isEligible) {
      const proceed = confirm(
        `Warning: ${employee.full_name} ${eligibility.reason}. Enabling student pay may result in incorrect wage calculations. Continue anyway?`
      );
      if (!proceed) return;
    }
    
    // Warn if disabling student pay for eligible employee
    if (!studentPayEnabled && eligibility.isEligible) {
      const proceed = confirm(
        `${employee.full_name} is ${eligibility.age} years old and eligible for student minimum wage. Disabling student pay will require them to receive regular minimum wage rates. Continue?`
      );
      if (!proceed) return;
    }
    
    try {
      setSaving(true);
      setError('');
      
      // Update the employee's student pay setting
      const { error: updateError } = await supabase
        .from('users')
        .update({
          student_pay_enabled: studentPayEnabled,
          updated_at: new Date().toISOString()
        })
        .eq('id', employee.id);
      
      if (updateError) throw updateError;
      
      // Log the change for audit purposes
      await supabase
        .from('audit_logs')
        .insert({
          user_id: authUser?.id,
          business_id: businessId,
          event_type: 'student_pay_setting_changed',
          details: {
            employee_id: employee.id,
            employee_name: employee.full_name,
            old_setting: originalStudentPayEnabled,
            new_setting: studentPayEnabled,
            employee_age: eligibility.age,
            is_eligible: eligibility.isEligible,
            changed_by: authUser?.id,
            timestamp: new Date().toISOString()
          }
        });
      
      // Check if this change affects wage calculations
      const wageImpact = getWageImpact();
      if (wageImpact.wouldAffectWage) {
        const message = studentPayEnabled 
          ? `${employee.full_name} is now eligible for student minimum wage (${wageImpact.studentMinWage}/hr instead of ${wageImpact.regularMinWage}/hr).`
          : `${employee.full_name} will now receive regular minimum wage (${wageImpact.regularMinWage}/hr instead of ${wageImpact.studentMinWage}/hr).`;
        
        alert(`Student pay setting updated. ${message} This will affect future payroll calculations.`);
      }
      
      // Call callback to update parent component
      if (onStudentPayUpdated) {
        onStudentPayUpdated(employee.id, studentPayEnabled, eligibility);
      }
      
      console.log(`Updated student pay setting for ${employee.full_name}: ${studentPayEnabled}`);
      onClose();
      
    } catch (err) {
      console.error('Error updating student pay setting:', err);
      setError('Failed to update student pay setting: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !employee) return null;

  const eligibility = getStudentEligibility();
  const wageImpact = getWageImpact();
  const hasChanges = studentPayEnabled !== originalStudentPayEnabled;

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: TavariStyles.spacing.md
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      width: '100%',
      maxWidth: '600px',
      maxHeight: '90vh',
      overflow: 'auto',
      boxShadow: TavariStyles.shadows?.xl || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
    },
    header: {
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: TavariStyles.colors.warning + '10'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    closeButton: {
      background: 'none',
      border: 'none',
      color: TavariStyles.colors.gray500,
      cursor: 'pointer',
      padding: TavariStyles.spacing.sm,
      borderRadius: TavariStyles.borderRadius?.md || '6px'
    },
    content: {
      padding: TavariStyles.spacing.xl
    },
    employeeInfo: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.lg
    },
    employeeName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800
    },
    employeeDetails: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs
    },
    section: {
      marginBottom: TavariStyles.spacing.xl
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },
    infoCard: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.infoBg,
      border: `1px solid ${TavariStyles.colors.info}30`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.md
    },
    warningCard: {
      backgroundColor: TavariStyles.colors.warningBg,
      border: `1px solid ${TavariStyles.colors.warning}30`,
      color: TavariStyles.colors.warning
    },
    successCard: {
      backgroundColor: TavariStyles.colors.successBg,
      border: `1px solid ${TavariStyles.colors.success}30`,
      color: TavariStyles.colors.success
    },
    errorCard: {
      backgroundColor: TavariStyles.colors.errorBg,
      border: `1px solid ${TavariStyles.colors.danger}30`,
      color: TavariStyles.colors.danger
    },
    cardTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.sm,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    cardText: {
      fontSize: TavariStyles.typography.fontSize.sm,
      lineHeight: 1.4
    },
    toggleContainer: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    },
    toggleLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
      flex: 1
    },
    toggle: {
      position: 'relative',
      width: '48px',
      height: '24px',
      backgroundColor: studentPayEnabled ? TavariStyles.colors.success : TavariStyles.colors.gray300,
      borderRadius: '12px',
      cursor: 'pointer',
      transition: 'background-color 0.2s',
      border: 'none'
    },
    toggleCircle: {
      position: 'absolute',
      top: '2px',
      left: studentPayEnabled ? '26px' : '2px',
      width: '20px',
      height: '20px',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: '50%',
      transition: 'left 0.2s',
      boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
    },
    errorMessage: {
      color: TavariStyles.colors.danger,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginTop: TavariStyles.spacing.sm,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    actions: {
      padding: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      gap: TavariStyles.spacing.md,
      justifyContent: 'flex-end'
    },
    button: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      border: 'none'
    },
    cancelButton: {
      backgroundColor: TavariStyles.colors.gray100,
      color: TavariStyles.colors.gray700,
      border: `1px solid ${TavariStyles.colors.gray300}`
    },
    saveButton: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    disabledButton: {
      opacity: 0.6,
      cursor: 'not-allowed'
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            <GraduationCap size={24} />
            Student Minimum Wage Settings
          </h2>
          <button
            onClick={onClose}
            style={styles.closeButton}
            disabled={saving}
          >
            <X size={20} />
          </button>
        </div>

        <div style={styles.content}>
          {/* Employee Information */}
          <div style={styles.employeeInfo}>
            <div style={styles.employeeName}>{employee.full_name}</div>
            <div style={styles.employeeDetails}>
              {employee.employee_number && `#${employee.employee_number} • `}
              <PositionLabel businessId={businessId} value={employee.position} emptyFallback="Employee" />
              {' '}• {employee.employment_status || 'Active'}
              <br />
              Age: {eligibility.age !== null ? `${eligibility.age} years old` : 'Not set'} • 
              Current Wage: ${wageImpact.currentWage.toFixed(2)}/hour
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div style={styles.errorMessage}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {/* Business Student Pay Status */}
          {!businessStudentPayEnabled && (
            <div style={{...styles.infoCard, ...styles.warningCard}}>
              <div style={styles.cardTitle}>
                <AlertCircle size={16} />
                Business Setting: Student Pay Disabled
              </div>
              <div style={styles.cardText}>
                Student minimum wage is currently disabled at the business level. Contact your system administrator to enable student pay rates for this business.
              </div>
            </div>
          )}

          {/* Eligibility Status */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Student Minimum Wage Eligibility</div>
            
            <div style={{
              ...styles.infoCard,
              ...(eligibility.isEligible ? styles.successCard : styles.errorCard)
            }}>
              <div style={styles.cardTitle}>
                <Info size={16} />
                {eligibility.isEligible ? 'Eligible for Student Rate' : 'Not Eligible for Student Rate'}
              </div>
              <div style={styles.cardText}>
                {eligibility.hasValidBirthDate ? (
                  <>
                    Employee is {eligibility.age} years old. {eligibility.isEligible 
                      ? 'Qualifies for student minimum wage rates under Ontario Employment Standards Act.'
                      : 'Must receive regular minimum wage as they are 18 or older.'
                    }
                  </>
                ) : (
                  'Birth date not set. Cannot determine age eligibility for student minimum wage rates.'
                )}
              </div>
            </div>
          </div>

          {/* Wage Impact Information */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Wage Rate Impact</div>
            
            <div style={styles.infoCard}>
              <div style={styles.cardTitle}>
                <DollarSign size={16} />
                Minimum Wage Rates
              </div>
              <div style={styles.cardText}>
                <strong>Regular Minimum Wage:</strong> ${wageImpact.regularMinWage.toFixed(2)}/hour<br />
                <strong>Student Minimum Wage:</strong> ${wageImpact.studentMinWage.toFixed(2)}/hour<br />
                <strong>Difference:</strong> ${wageImpact.difference.toFixed(2)}/hour less for students<br />
                <br />
                <strong>Employee's Current Wage:</strong> ${wageImpact.currentWage.toFixed(2)}/hour
                {wageImpact.wouldAffectWage && (
                  <span style={{color: TavariStyles.colors.warning}}> (Will be affected by this setting)</span>
                )}
              </div>
            </div>
          </div>

          {/* Student Pay Toggle */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Student Pay Setting</div>
            
            <div style={styles.toggleContainer}>
              <div style={styles.toggleLabel}>
                Enable Student Minimum Wage for {employee.full_name}
              </div>
              <button
                style={styles.toggle}
                onClick={() => setStudentPayEnabled(!studentPayEnabled)}
                disabled={saving || !businessStudentPayEnabled}
              >
                <div style={styles.toggleCircle} />
              </button>
            </div>
            
            <div style={{
              fontSize: TavariStyles.typography.fontSize.xs,
              color: TavariStyles.colors.gray600,
              marginTop: TavariStyles.spacing.sm
            }}>
              {studentPayEnabled 
                ? `${employee.full_name} will receive student minimum wage rates when eligible`
                : `${employee.full_name} will receive regular minimum wage rates regardless of age`
              }
            </div>
          </div>

          {/* Current Status Summary */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Current Status Summary</div>
            
            <div style={styles.infoCard}>
              <div style={styles.cardTitle}>
                <Clock size={16} />
                Effective Wage Rate
              </div>
              <div style={styles.cardText}>
                Based on current settings, {employee.full_name} will receive:
                <br />
                <strong>
                  {studentPayEnabled && eligibility.isEligible 
                    ? `Student minimum wage: $${wageImpact.studentMinWage.toFixed(2)}/hour`
                    : `Regular minimum wage: $${wageImpact.regularMinWage.toFixed(2)}/hour`
                  }
                </strong>
                {wageImpact.currentWage > Math.max(wageImpact.regularMinWage, wageImpact.studentMinWage) && (
                  <span style={{color: TavariStyles.colors.success}}>
                    <br />Note: Current wage (${wageImpact.currentWage.toFixed(2)}/hour) is above minimum wage
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div style={styles.actions}>
          <button
            onClick={onClose}
            style={styles.cancelButton}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              ...styles.button, 
              ...styles.saveButton,
              ...(!hasChanges || saving ? styles.disabledButton : {})
            }}
            disabled={!hasChanges || saving}
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save Setting'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmployeeStudentPaySettings;