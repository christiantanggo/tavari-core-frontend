// components/HR/HREmployeeProfilesComponents/EmployeeBirthdayManager.jsx - Birthday and Age Management Modal
import React, { useState, useEffect } from 'react';
import { X, User, Calendar, AlertCircle, Save, Trash2 } from 'lucide-react';
import { supabase } from '../../../supabaseClient';
import { TavariStyles } from '../../../utils/TavariStyles';
import PositionLabel from '../PositionLabel';

const EmployeeBirthdayManager = ({
  isOpen,
  onClose,
  employee,
  businessId,
  onBirthdayUpdated
}) => {
  const [birthDate, setBirthDate] = useState('');
  const [originalBirthDate, setOriginalBirthDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  // Load current birthday data when modal opens
  useEffect(() => {
    if (isOpen && employee) {
      const currentBirthDate = employee.birth_date ? employee.birth_date.split('T')[0] : '';
      setBirthDate(currentBirthDate);
      setOriginalBirthDate(currentBirthDate);
      setError('');
      setShowConfirmDelete(false);
    }
  }, [isOpen, employee]);

  // Calculate age from birth date
  const calculateAge = (birthDateStr) => {
    if (!birthDateStr) return null;
    const today = new Date();
    const birth = new Date(birthDateStr);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  };

  // Get next birthday
  const getNextBirthday = (birthDateStr) => {
    if (!birthDateStr) return null;
    const today = new Date();
    const birth = new Date(birthDateStr);
    const thisYear = today.getFullYear();
    let nextBirthday = new Date(thisYear, birth.getMonth(), birth.getDate());
    
    if (nextBirthday < today) {
      nextBirthday = new Date(thisYear + 1, birth.getMonth(), birth.getDate());
    }
    
    return nextBirthday;
  };

  // Check if employee will be student eligible
  const checkStudentStatus = (birthDateStr) => {
    const age = calculateAge(birthDateStr);
    if (age === null) return null;
    
    const isCurrentlyStudent = age < 18;
    const willTurn18Soon = age === 17;
    
    return {
      isStudent: isCurrentlyStudent,
      willTurn18Soon,
      turn18Date: willTurn18Soon ? getNextBirthday(birthDateStr) : null
    };
  };

  // Validate birth date
  const validateBirthDate = (dateStr) => {
    if (!dateStr) return { isValid: true, message: '' };
    
    const birth = new Date(dateStr);
    const today = new Date();
    const minDate = new Date(today.getFullYear() - 100, 0, 1); // 100 years ago
    
    if (birth > today) {
      return { isValid: false, message: 'Birth date cannot be in the future' };
    }
    
    if (birth < minDate) {
      return { isValid: false, message: 'Birth date cannot be more than 100 years ago' };
    }
    
    const age = calculateAge(dateStr);
    if (age < 14) {
      return { isValid: false, message: 'Employee must be at least 14 years old for employment' };
    }
    
    return { isValid: true, message: '' };
  };

  const handleSave = async () => {
    if (!employee) return;
    
    // Validate birth date
    const validation = validateBirthDate(birthDate);
    if (!validation.isValid) {
      setError(validation.message);
      return;
    }
    
    try {
      setSaving(true);
      setError('');
      
      // Update the employee's birth date
      const { error: updateError } = await supabase
        .from('users')
        .update({
          birth_date: birthDate || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', employee.id);
      
      if (updateError) throw updateError;
      
      // Calculate new student status and potentially update student_pay_enabled
      const studentStatus = checkStudentStatus(birthDate);
      if (studentStatus && birthDate) {
        // If employee is now under 18 and student_pay_enabled is false, ask if they want to enable it
        if (studentStatus.isStudent && !employee.student_pay_enabled) {
          const enableStudentPay = confirm(
            `${employee.full_name} is now ${calculateAge(birthDate)} years old and eligible for student minimum wage. Would you like to enable student pay for this employee?`
          );
          
          if (enableStudentPay) {
            await supabase
              .from('users')
              .update({ student_pay_enabled: true })
              .eq('id', employee.id);
          }
        }
        
        // If employee is now 18+ and has student pay enabled, ask if they want to disable it
        if (!studentStatus.isStudent && employee.student_pay_enabled) {
          const disableStudentPay = confirm(
            `${employee.full_name} is now ${calculateAge(birthDate)} years old and no longer eligible for student minimum wage. Would you like to disable student pay for this employee?`
          );
          
          if (disableStudentPay) {
            await supabase
              .from('users')
              .update({ student_pay_enabled: false })
              .eq('id', employee.id);
          }
        }
      }
      
      // Call callback to update parent component
      if (onBirthdayUpdated) {
        onBirthdayUpdated(employee.id, birthDate, studentStatus);
      }
      
      console.log(`Updated birthday for ${employee.full_name}: ${birthDate}`);
      onClose();
      
    } catch (err) {
      console.error('Error updating birthday:', err);
      setError('Failed to update birthday: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!employee) return;
    
    try {
      setSaving(true);
      setError('');
      
      // Remove the birth date
      const { error: updateError } = await supabase
        .from('users')
        .update({
          birth_date: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', employee.id);
      
      if (updateError) throw updateError;
      
      // If student pay was enabled, ask if they want to keep it
      if (employee.student_pay_enabled) {
        const keepStudentPay = confirm(
          `${employee.full_name} had student pay enabled. Without a birth date, we cannot determine age eligibility. Keep student pay enabled?`
        );
        
        if (!keepStudentPay) {
          await supabase
            .from('users')
            .update({ student_pay_enabled: false })
            .eq('id', employee.id);
        }
      }
      
      // Call callback to update parent component
      if (onBirthdayUpdated) {
        onBirthdayUpdated(employee.id, null, null);
      }
      
      console.log(`Removed birthday for ${employee.full_name}`);
      onClose();
      
    } catch (err) {
      console.error('Error removing birthday:', err);
      setError('Failed to remove birthday: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !employee) return null;

  const age = calculateAge(birthDate);
  const studentStatus = checkStudentStatus(birthDate);
  const validation = validateBirthDate(birthDate);
  const hasChanges = birthDate !== originalBirthDate;

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
      maxWidth: '500px',
      maxHeight: '90vh',
      overflow: 'auto',
      boxShadow: TavariStyles.shadows?.xl || '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
    },
    header: {
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
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
    section: {
      marginBottom: TavariStyles.spacing.xl
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
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
    formGroup: {
      marginBottom: TavariStyles.spacing.lg
    },
    label: {
      display: 'block',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.sm
    },
    input: {
      width: '100%',
      padding: TavariStyles.spacing.md,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      backgroundColor: TavariStyles.colors.white
    },
    inputError: {
      borderColor: TavariStyles.colors.danger,
      backgroundColor: TavariStyles.colors.errorBg
    },
    errorMessage: {
      color: TavariStyles.colors.danger,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginTop: TavariStyles.spacing.sm,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    infoCard: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.infoBg,
      border: `1px solid ${TavariStyles.colors.info}30`,
      borderRadius: TavariStyles.borderRadius?.md || '6px'
    },
    studentWarning: {
      backgroundColor: TavariStyles.colors.warningBg,
      border: `1px solid ${TavariStyles.colors.warning}30`,
      color: TavariStyles.colors.warning
    },
    studentEligible: {
      backgroundColor: TavariStyles.colors.successBg,
      border: `1px solid ${TavariStyles.colors.success}30`,
      color: TavariStyles.colors.success
    },
    infoTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.sm
    },
    infoText: {
      fontSize: TavariStyles.typography.fontSize.sm,
      lineHeight: 1.4
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
    deleteButton: {
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.danger,
      border: `1px solid ${TavariStyles.colors.danger}30`
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
            <User size={24} />
            Manage Birthday & Age
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
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div style={styles.errorMessage}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {/* Birth Date Input */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>
              <Calendar size={20} />
              Birth Date Information
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Birth Date</label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                style={{
                  ...styles.input,
                  ...(error && !validation.isValid ? styles.inputError : {})
                }}
                disabled={saving}
                max={new Date().toISOString().split('T')[0]} // Can't be future date
                min={new Date(new Date().getFullYear() - 100, 0, 1).toISOString().split('T')[0]} // 100 years ago max
              />
            </div>
          </div>

          {/* Age and Student Status Information */}
          {birthDate && validation.isValid && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>
                Age & Student Status Information
              </div>
              
              <div style={styles.infoCard}>
                <div style={styles.infoTitle}>Current Age & Status</div>
                <div style={styles.infoText}>
                  <strong>Age:</strong> {age} years old<br />
                  <strong>Birthday:</strong> {new Date(birthDate).toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}<br />
                  {getNextBirthday(birthDate) && (
                    <>
                      <strong>Next Birthday:</strong> {getNextBirthday(birthDate).toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                    </>
                  )}
                </div>
              </div>

              {studentStatus && (
                <div style={{
                  ...styles.infoCard,
                  marginTop: TavariStyles.spacing.md,
                  ...(studentStatus.isStudent ? styles.studentEligible : {}),
                  ...(studentStatus.willTurn18Soon ? styles.studentWarning : {})
                }}>
                  <div style={styles.infoTitle}>
                    Student Minimum Wage Status
                  </div>
                  <div style={styles.infoText}>
                    {studentStatus.isStudent ? (
                      <>
                        <strong>Eligible for Student Rate:</strong> YES (Under 18)<br />
                        <strong>Current Student Pay Setting:</strong> {employee.student_pay_enabled ? 'Enabled' : 'Disabled'}<br />
                        {studentStatus.willTurn18Soon && studentStatus.turn18Date && (
                          <>
                            <br />
                            <strong>⚠️ Important:</strong> Will turn 18 on {studentStatus.turn18Date.toLocaleDateString()}<br />
                            Student wage eligibility will end on that date.
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <strong>Eligible for Student Rate:</strong> NO (18 or older)<br />
                        <strong>Must receive:</strong> Regular minimum wage<br />
                        {employee.student_pay_enabled && (
                          <>
                            <br />
                            <strong>⚠️ Warning:</strong> Student pay is currently enabled but employee is not eligible.
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Confirmation Dialog for Delete */}
          {showConfirmDelete && (
            <div style={{
              ...styles.infoCard,
              ...styles.studentWarning,
              marginBottom: TavariStyles.spacing.lg
            }}>
              <div style={styles.infoTitle}>Confirm Delete Birthday</div>
              <div style={styles.infoText}>
                Are you sure you want to remove {employee.full_name}'s birthday? This will:
                <ul style={{ marginTop: TavariStyles.spacing.sm, paddingLeft: '20px' }}>
                  <li>Remove age verification for student wage eligibility</li>
                  <li>May affect payroll calculations</li>
                  <li>Cannot automatically determine employment law age requirements</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div style={styles.actions}>
          {originalBirthDate && !showConfirmDelete && (
            <button
              onClick={() => setShowConfirmDelete(true)}
              style={{...styles.button, ...styles.deleteButton}}
              disabled={saving}
            >
              <Trash2 size={16} />
              Remove Birthday
            </button>
          )}
          
          {showConfirmDelete && (
            <>
              <button
                onClick={() => setShowConfirmDelete(false)}
                style={{...styles.button, ...styles.cancelButton}}
                disabled={saving}
              >
                Cancel Delete
              </button>
              <button
                onClick={handleDelete}
                style={{
                  ...styles.button, 
                  ...styles.deleteButton,
                  ...(saving ? styles.disabledButton : {})
                }}
                disabled={saving}
              >
                <Trash2 size={16} />
                {saving ? 'Removing...' : 'Confirm Remove'}
              </button>
            </>
          )}
          
          {!showConfirmDelete && (
            <>
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
                  ...(!hasChanges || !validation.isValid || saving ? styles.disabledButton : {})
                }}
                disabled={!hasChanges || !validation.isValid || saving}
              >
                <Save size={16} />
                {saving ? 'Saving...' : 'Save Birthday'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmployeeBirthdayManager;