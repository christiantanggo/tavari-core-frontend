// components/HR/HREmployeeProfilesComponents/EmployeeSINManager.jsx - Fixed for Users Table
import React, { useState, useEffect } from 'react';
import { X, Shield, Lock, Eye, EyeOff, AlertCircle, Save, Trash2, KeyRound } from 'lucide-react';
import { supabase } from '../../../supabaseClient';

// Import all required consistency files
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../Auth/POSAuthWrapper';
import TavariCheckbox from '../../UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';
import PositionLabel from '../PositionLabel';

import bcrypt from 'bcryptjs';

const EmployeeSINManager = ({
  isOpen,
  onClose,
  employee, // This is actually a user object from the users table
  businessId,
  authUser,
  onSINUpdated
}) => {
  const [managerPIN, setManagerPIN] = useState('');
  const [sinNumber, setSinNumber] = useState('');
  const [confirmSIN, setConfirmSIN] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showSIN, setShowSIN] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState('add');
  const [currentSIN, setCurrentSIN] = useState('');
  const [sinRecord, setSinRecord] = useState(null);

  // Security context
  const securityContext = useSecurityContext({
    componentName: 'EmployeeSINManager',
    sensitiveComponent: true,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'critical'
  }) || {};

  const { logSecurityEvent = () => {} } = securityContext;

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'hr_admin'],
    requireBusiness: true,
    componentName: 'EmployeeSINManager'
  });

  const effectiveBusinessId = businessId || auth.selectedBusinessId;
  const effectiveAuthUser = authUser || auth.authUser;

  // Reset when modal opens
  useEffect(() => {
    if (isOpen && employee) {
      console.log('INIT: Opening SIN manager for user:', employee.id);
      
      setManagerPIN('');
      setSinNumber('');
      setConfirmSIN('');
      setCurrentSIN('');
      setSinRecord(null);
      setIsAuthenticated(false);
      setShowSIN(false);
      setError('');
      
      // Check if user has SIN record
      checkExistingSIN();
    }
  }, [isOpen, employee?.id]);

  // Check if user has existing SIN record
  const checkExistingSIN = async () => {
    try {
      console.log('INIT: Checking for existing SIN record');
      
      const { data, error } = await supabase
        .from('employee_sin_numbers')
        .select('*')
        .eq('employee_id', employee.id)
        .maybeSingle();

      console.log('INIT: SIN check result:', { data: !!data, error });

      if (error && error.code !== 'PGRST116') {
        console.error('Error checking SIN:', error);
        return;
      }

      setSinRecord(data);
      setViewMode(data ? 'view' : 'add');
      
    } catch (err) {
      console.error('Error in checkExistingSIN:', err);
    }
  };

  // Format SIN for display
  const formatSIN = (value) => {
    const numbers = value.replace(/\D/g, '');
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 6) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 6)}-${numbers.slice(6, 9)}`;
  };

  // Validate SIN using Luhn algorithm
  const validateSIN = (sinValue) => {
    if (!sinValue) return { isValid: false, message: 'SIN number is required' };
    
    const numbers = sinValue.replace(/\D/g, '');
    if (numbers.length !== 9) {
      return { isValid: false, message: 'SIN must be exactly 9 digits' };
    }
    
    // Luhn algorithm validation
    const digits = numbers.split('').map(d => parseInt(d));
    let sum = 0;
    
    for (let i = 0; i < 8; i++) {
      let digit = digits[i];
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) {
          digit = Math.floor(digit / 10) + (digit % 10);
        }
      }
      sum += digit;
    }
    
    const checkDigit = (10 - (sum % 10)) % 10;
    if (checkDigit !== digits[8]) {
      return { isValid: false, message: 'Invalid SIN number (failed check digit validation)' };
    }
    
    return { isValid: true, message: '' };
  };

  // Log access for audit trail
  const logSINAccess = async (action, details = {}) => {
    try {
      // Update access log in SIN record
      if (sinRecord) {
        const newAccessEntry = {
          timestamp: new Date().toISOString(),
          action,
          user_id: effectiveAuthUser?.id,
          user_email: effectiveAuthUser?.email,
          ...details
        };

        const updatedAccessLog = [...(sinRecord.access_log || []), newAccessEntry];

        await supabase
          .from('employee_sin_numbers')
          .update({ 
            access_log: updatedAccessLog,
            updated_at: new Date().toISOString()
          })
          .eq('id', sinRecord.id);
      }

      // Also log to security context
      logSecurityEvent(`sin_${action}`, {
        employee_id: employee.id,
        employee_name: employee.full_name,
        ...details
      }, 'high');

    } catch (err) {
      console.warn('Failed to log SIN access:', err);
    }
  };

  // Verify manager PIN
  const verifyManagerPIN = async () => {
    if (!managerPIN) {
      setError('Please enter your manager PIN');
      return;
    }

    try {
      setError('');
      setSaving(true);
      
      console.log('PIN_CHECK: Verifying PIN for user:', effectiveAuthUser?.id);

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('pin')
        .eq('id', effectiveAuthUser?.id)
        .single();

      if (userError) throw userError;

      const storedPin = userData?.pin;
      if (!storedPin) {
        setError('No PIN configured for your account. Contact administrator.');
        return;
      }

      const pinMatches = await bcrypt.compare(managerPIN, storedPin);
      console.log('PIN_CHECK: PIN matches:', pinMatches);

      if (pinMatches) {
        setIsAuthenticated(true);
        
        // Load SIN data if in view mode
        if (sinRecord && viewMode === 'view') {
          console.log('PIN_CHECK: Loading encrypted SIN data for viewing');
          await loadDecryptedSIN();
        }
        
        // Clear form for edit mode
        if (viewMode === 'edit') {
          setSinNumber('');
          setConfirmSIN('');
        }
      } else {
        setError('Invalid PIN. Please try again.');
        
        // Log failed attempt
        await logSINAccess('failed_pin_attempt', {
          attempted_by: effectiveAuthUser?.id
        });
      }
    } catch (err) {
      console.error('PIN_CHECK: Error:', err);
      setError('Failed to verify PIN: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Load and decrypt SIN using PostgreSQL function
  const loadDecryptedSIN = async () => {
    try {
      console.log('DECRYPT: Loading decrypted SIN from database');
      
      // Use PostgreSQL function to decrypt - pass business_id not encryption_key
      const { data, error } = await supabase.rpc('decrypt_sin', {
        encrypted_data: sinRecord.sin_number_encrypted,
        business_id: effectiveBusinessId
      });

      console.log('DECRYPT: Result:', { data: !!data, error });

      if (error) throw error;

      if (data && data.length === 9) {
        setCurrentSIN(data);
        console.log('DECRYPT: SIN decryption successful');
        
        // Log the access
        await logSINAccess('viewed', {
          sin_record_id: sinRecord.id
        });
      } else {
        console.log('DECRYPT: Invalid SIN data returned');
        setError('Unable to decrypt SIN data. Contact administrator.');
      }
    } catch (err) {
      console.error('DECRYPT: Error:', err);
      setError('Failed to decrypt SIN: ' + err.message);
    }
  };

  // Save SIN number with PostgreSQL encryption
  const handleSave = async () => {
    if (!employee || !isAuthenticated) return;
    
    console.log('SAVE: Starting save process');
    
    // Validate SIN
    const validation = validateSIN(sinNumber);
    if (!validation.isValid) {
      setError(validation.message);
      return;
    }
    
    // Check confirmation
    if (sinNumber !== confirmSIN) {
      setError('SIN numbers do not match');
      return;
    }
    
    try {
      setSaving(true);
      setError('');
      
      const cleanSIN = sinNumber.replace(/\D/g, '');
      console.log('SAVE: Clean SIN length:', cleanSIN.length);
      
      // Use PostgreSQL function to encrypt - pass business_id not encryption_key
      const { data: encryptedData, error: encryptError } = await supabase.rpc('encrypt_sin', {
        sin_text: cleanSIN,
        business_id: effectiveBusinessId
      });

      console.log('ENCRYPT: Result:', { data: !!encryptedData, error: encryptError });

      if (encryptError) throw encryptError;
      if (!encryptedData) throw new Error('Encryption failed');

      let result;
      
      if (sinRecord) {
        // Update existing record
        console.log('SAVE: Updating existing SIN record');
        result = await supabase
          .from('employee_sin_numbers')
          .update({
            sin_number_encrypted: encryptedData,
            updated_by: effectiveAuthUser?.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', sinRecord.id)
          .select()
          .single();
      } else {
        // Create new record
        console.log('SAVE: Creating new SIN record');
        result = await supabase
          .from('employee_sin_numbers')
          .insert({
            employee_id: employee.id,
            sin_number_encrypted: encryptedData,
            created_by: effectiveAuthUser?.id,
            updated_by: effectiveAuthUser?.id
          })
          .select()
          .single();
      }
      
      console.log('SAVE: Database result:', { data: !!result.data, error: result.error });
      
      if (result.error) throw result.error;
      
      // Update local state
      setSinRecord(result.data);
      
      // Log the save action
      await logSINAccess(sinRecord ? 'updated' : 'created', {
        sin_record_id: result.data.id
      });
      
      // Callback to update parent
      if (onSINUpdated) {
        onSINUpdated(employee.id, true);
      }
      
      console.log('SAVE: Success!');
      alert(`SUCCESS! SIN saved and encrypted for ${employee.full_name}`);
      onClose();
      
    } catch (err) {
      console.error('SAVE: Failed:', err);
      setError('Failed to save SIN: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Delete SIN record
  const handleDelete = async () => {
    if (!sinRecord || !isAuthenticated) return;
    
    if (!window.confirm(`Are you sure you want to delete the encrypted SIN for ${employee.full_name}? This action cannot be undone.`)) {
      return;
    }
    
    try {
      setSaving(true);
      setError('');
      
      console.log('DELETE: Removing SIN record');
      
      const { error } = await supabase
        .from('employee_sin_numbers')
        .delete()
        .eq('id', sinRecord.id);
      
      if (error) throw error;
      
      // Log the deletion
      await logSINAccess('deleted', {
        sin_record_id: sinRecord.id
      });
      
      if (onSINUpdated) {
        onSINUpdated(employee.id, false);
      }
      
      console.log('DELETE: Success');
      alert('SIN record successfully deleted');
      onClose();
      
    } catch (err) {
      console.error('DELETE: Failed:', err);
      setError('Failed to delete SIN: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !employee) return null;

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
      maxWidth: '550px',
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
      backgroundColor: TavariStyles.colors.gray900 + '05'
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
      padding: TavariStyles.spacing.sm
    },
    content: {
      padding: TavariStyles.spacing.xl
    },
    securityWarning: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.successBg,
      border: `1px solid ${TavariStyles.colors.success}30`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.lg,
      color: TavariStyles.colors.success
    },
    warningTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.sm,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
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
      backgroundColor: TavariStyles.colors.white,
      boxSizing: 'border-box'
    },
    pinInput: {
      fontFamily: 'monospace',
      letterSpacing: '2px',
      textAlign: 'center'
    },
    sinInput: {
      fontFamily: 'monospace',
      letterSpacing: '1px'
    },
    inputError: {
      borderColor: TavariStyles.colors.danger,
      backgroundColor: TavariStyles.colors.errorBg
    },
    inputGroup: {
      position: 'relative'
    },
    toggleButton: {
      position: 'absolute',
      right: TavariStyles.spacing.md,
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'none',
      border: 'none',
      color: TavariStyles.colors.gray500,
      cursor: 'pointer'
    },
    errorMessage: {
      color: TavariStyles.colors.danger,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginTop: TavariStyles.spacing.sm,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    helpText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs
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
    verifyButton: {
      backgroundColor: TavariStyles.colors.info,
      color: TavariStyles.colors.white
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
    },
    modeButtons: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.sm
    },
    modeButton: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray600
    },
    modeButtonActive: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.primary}`
    },
    sinDisplay: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px'
    },
    sinValue: {
      flex: 1,
      fontFamily: 'monospace',
      fontSize: TavariStyles.typography.fontSize.lg,
      letterSpacing: '2px',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    }
  };

  const sinValidation = validateSIN(sinNumber);
  const canSave = isAuthenticated && (viewMode === 'add' || viewMode === 'edit') && sinValidation.isValid && sinNumber === confirmSIN;

  return (
    <SecurityWrapper
      componentName="EmployeeSINManager"
      sensitiveComponent={true}
      enableRateLimiting={false}
      enableAuditLogging={true}
      securityLevel="critical"
    >
      <POSAuthWrapper
        requiredRoles={['owner', 'manager', 'hr_admin']}
        requireBusiness={true}
        componentName="EmployeeSINManager"
      >
        <div style={styles.overlay} onClick={onClose}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.header}>
              <h2 style={styles.title}>
                <Shield size={24} />
                Manage SIN Number
              </h2>
              <button onClick={onClose} style={styles.closeButton} disabled={saving}>
                <X size={20} />
              </button>
            </div>

            <div style={styles.content}>
              {/* Security Info */}
              <div style={styles.securityWarning}>
                <div style={styles.warningTitle}>
                  <Lock size={16} />
                  PostgreSQL Database Encryption Active
                </div>
                <div style={{fontSize: TavariStyles.typography.fontSize.sm}}>
                  SIN numbers are encrypted using PostgreSQL's pgcrypto extension and stored in a secure dedicated table with full audit logging.
                </div>
              </div>

              {/* Employee Information - Fixed to use users table fields */}
              <div style={styles.employeeInfo}>
                <div style={styles.employeeName}>{employee.full_name}</div>
                <div style={styles.employeeDetails}>
                  {employee.employee_number && `#${employee.employee_number} • `}
                  <PositionLabel businessId={businessId} value={employee.position} emptyFallback="Employee" />
                  {' '}• {employee.employment_status || 'Active'}
                  {employee.email && ` • ${employee.email}`}
                </div>
                <div style={styles.employeeDetails}>
                  SIN Status: {sinRecord ? 'On File (PG Encrypted)' : 'Not Provided'}
                  {sinRecord && (
                    <div style={{fontSize: '11px', marginTop: '4px'}}>
                      Created: {new Date(sinRecord.created_at).toLocaleDateString()}
                      {sinRecord.updated_at !== sinRecord.created_at && (
                        <span> • Updated: {new Date(sinRecord.updated_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  )}
                </div>
                
                {/* Mode Controls */}
                {isAuthenticated && sinRecord && (
                  <div style={{marginTop: TavariStyles.spacing.md}}>
                    <div style={styles.modeButtons}>
                      <button
                        onClick={() => setViewMode('view')}
                        style={{
                          ...styles.modeButton,
                          ...(viewMode === 'view' ? styles.modeButtonActive : {})
                        }}
                      >
                        View SIN
                      </button>
                      <button
                        onClick={() => setViewMode('edit')}
                        style={{
                          ...styles.modeButton,
                          ...(viewMode === 'edit' ? styles.modeButtonActive : {})
                        }}
                      >
                        Edit SIN
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Error Message */}
              {error && (
                <div style={styles.errorMessage}>
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}

              {/* Manager PIN Verification */}
              {!isAuthenticated && (
                <div style={styles.formGroup}>
                  <label style={styles.label}>Manager PIN Verification</label>
                  <div style={styles.inputGroup}>
                    <input
                      type={showSIN ? "text" : "password"}
                      value={managerPIN}
                      onChange={(e) => setManagerPIN(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && verifyManagerPIN()}
                      style={{...styles.input, ...styles.pinInput}}
                      placeholder="Enter your 4-digit PIN"
                      maxLength="4"
                      disabled={saving}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSIN(!showSIN)}
                      style={styles.toggleButton}
                      disabled={saving}
                    >
                      {showSIN ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <div style={styles.helpText}>
                    Enter your manager PIN to access encrypted SIN data
                  </div>
                </div>
              )}

              {/* SIN Display/Entry */}
              {isAuthenticated && (
                <>
                  {/* View Mode */}
                  {viewMode === 'view' && currentSIN && (
                    <div style={styles.formGroup}>
                      <label style={styles.label}>
                        Social Insurance Number (SIN)
                      </label>
                      <div style={styles.sinDisplay}>
                        <div style={styles.sinValue}>
                          {showSIN ? formatSIN(currentSIN) : '•••-•••-•••'}
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowSIN(!showSIN)}
                          style={styles.toggleButton}
                        >
                          {showSIN ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <div style={styles.helpText}>
                        This encrypted SIN is used for payroll tax reporting (T4s, ROEs)
                      </div>
                    </div>
                  )}

                  {/* Edit/Add Mode */}
                  {(viewMode === 'add' || viewMode === 'edit') && (
                    <>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>
                          Social Insurance Number (SIN)
                        </label>
                        <input
                          type="text"
                          value={formatSIN(sinNumber)}
                          onChange={(e) => {
                            const value = e.target.value.replace(/\D/g, '');
                            if (value.length <= 9) {
                              setSinNumber(value);
                            }
                          }}
                          style={{
                            ...styles.input, 
                            ...styles.sinInput,
                            ...(error && !sinValidation.isValid ? styles.inputError : {})
                          }}
                          placeholder="XXX-XXX-XXX"
                          disabled={saving}
                        />
                        <div style={styles.helpText}>
                          Enter the 9-digit Social Insurance Number (will be encrypted using PostgreSQL)
                        </div>
                      </div>

                      <div style={styles.formGroup}>
                        <label style={styles.label}>
                          Confirm SIN Number
                        </label>
                        <input
                          type="text"
                          value={formatSIN(confirmSIN)}
                          onChange={(e) => {
                            const value = e.target.value.replace(/\D/g, '');
                            if (value.length <= 9) {
                              setConfirmSIN(value);
                            }
                          }}
                          style={{
                            ...styles.input, 
                            ...styles.sinInput,
                            ...(confirmSIN && sinNumber !== confirmSIN ? styles.inputError : {})
                          }}
                          placeholder="XXX-XXX-XXX"
                          disabled={saving}
                        />
                        <div style={styles.helpText}>
                          Re-enter the SIN number to confirm
                        </div>
                      </div>

                      {/* Validation Messages */}
                      {sinNumber && !sinValidation.isValid && (
                        <div style={styles.errorMessage}>
                          <AlertCircle size={16} />
                          {sinValidation.message}
                        </div>
                      )}

                      {confirmSIN && sinNumber !== confirmSIN && (
                        <div style={styles.errorMessage}>
                          <AlertCircle size={16} />
                          SIN numbers do not match
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            <div style={styles.actions}>
              {isAuthenticated && sinRecord && viewMode === 'view' && (
                <button
                  onClick={handleDelete}
                  style={{...styles.button, ...styles.deleteButton}}
                  disabled={saving}
                >
                  <Trash2 size={16} />
                  Delete SIN
                </button>
              )}

              <button
                onClick={onClose}
                style={{...styles.button, ...styles.cancelButton}}
                disabled={saving}
              >
                Cancel
              </button>
              
              {!isAuthenticated ? (
                <button
                  onClick={verifyManagerPIN}
                  style={{
                    ...styles.button, 
                    ...styles.verifyButton,
                    ...(saving || !managerPIN ? styles.disabledButton : {})
                  }}
                  disabled={saving || !managerPIN}
                >
                  <KeyRound size={16} />
                  {saving ? 'Verifying...' : 'Verify PIN'}
                </button>
              ) : (viewMode === 'add' || viewMode === 'edit') ? (
                <button
                  onClick={handleSave}
                  style={{
                    ...styles.button, 
                    ...styles.saveButton,
                    ...(!canSave || saving ? styles.disabledButton : {})
                  }}
                  disabled={!canSave || saving}
                >
                  <Save size={16} />
                  {saving ? 'Encrypting & Saving...' : 'Save SIN'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default EmployeeSINManager;