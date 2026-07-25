// components/HR/FixEmployeeAuthModal.jsx
// Tool to create Supabase Auth accounts for employees already in users table
// UPDATED: Uses Edge Function for secure auth account creation
import React, { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';

const FixEmployeeAuthModal = ({ 
  isOpen, 
  onClose, 
  employee, // Pass the employee object from users table
  onSuccess 
}) => {
  const [method, setMethod] = useState('invite'); // 'invite' or 'password'
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  if (!isOpen || !employee) return null;

  const handleCreateAuthAccount = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      console.log('🔧 Creating auth account for existing user:', employee.email);

      // Validate password if using password method
      if (method === 'password') {
        if (!temporaryPassword || temporaryPassword.length < 6) {
          setError('Password must be at least 6 characters');
          setLoading(false);
          return;
        }
      }

      // Get current user's auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated. Please log in again.');
      }

      console.log('📡 Calling Edge Function...');

      // Call Edge Function
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-employee-auth`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            method: method,
            employee_email: employee.email,
            employee_id: employee.id,
            first_name: employee.first_name,
            last_name: employee.last_name,
            full_name: employee.full_name,
            temporary_password: method === 'password' ? temporaryPassword : null
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        // Handle specific error messages
        if (result.error?.includes('already registered')) {
          setError('⚠️ Auth account already exists. Use "Password Reset" option instead.');
          setLoading(false);
          return;
        }
        throw new Error(result.error || result.details || 'Failed to create auth account');
      }

      console.log('✅ Auth account created:', result);

      // Set success message based on method
      if (method === 'invite') {
        setSuccess(`✅ Invite email sent to ${employee.email}!\n\nEmployee will receive an email with a link to set their password. The link is valid for 24 hours.`);
      } else if (method === 'password') {
        setSuccess(`✅ Auth account created successfully!\n\nEmployee Login Details:\nEmail: ${employee.email}\nPassword: ${temporaryPassword}\n\n⚠️ IMPORTANT: Share these credentials securely and tell employee to change password immediately after first login!`);
      }

      // Clear password field
      setTemporaryPassword('');

      // Call success callback
      if (onSuccess) {
        setTimeout(() => {
          onSuccess(employee.id);
        }, 2000);
      }

    } catch (err) {
      console.error('❌ Error creating auth account:', err);
      setError(`Failed to create auth account: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      console.log('🔓 Sending password reset email...');
      
      // Get current user's auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated. Please log in again.');
      }

      // Call Edge Function with reset method
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-employee-auth`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            method: 'reset',
            employee_email: employee.email,
            employee_id: employee.id
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || result.details || 'Failed to send reset email');
      }

      setSuccess(`✅ Password reset email sent to ${employee.email}!\n\nEmployee will receive an email with a link to reset their password. The link is valid for 1 hour.`);

    } catch (err) {
      console.error('❌ Error sending password reset:', err);
      setError(`Failed to send reset email: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setMethod('invite');
      setTemporaryPassword('');
      setError(null);
      setSuccess(null);
      onClose();
    }
  };

  const styles = {
    modal: {
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
      padding: TavariStyles.spacing.lg
    },
    modalContent: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing['3xl'],
      maxWidth: '600px',
      width: '100%',
      maxHeight: '90vh',
      overflow: 'auto',
      boxShadow: TavariStyles.shadows.xl
    },
    header: {
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.md,
      color: TavariStyles.colors.gray600
    },
    employeeInfo: {
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.lg,
      borderRadius: TavariStyles.borderRadius.md,
      marginBottom: TavariStyles.spacing.xl,
      fontSize: TavariStyles.typography.fontSize.sm,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    infoRow: {
      marginBottom: TavariStyles.spacing.xs
    },
    infoLabel: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      display: 'inline-block',
      minWidth: '100px'
    },
    warningBox: {
      backgroundColor: TavariStyles.colors.warningBg,
      border: `1px solid ${TavariStyles.colors.warning}`,
      borderRadius: TavariStyles.borderRadius.md,
      padding: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl,
      fontSize: TavariStyles.typography.fontSize.sm,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    warningIcon: {
      marginRight: TavariStyles.spacing.sm
    },
    methodSelector: {
      marginBottom: TavariStyles.spacing.xl
    },
    methodOption: {
      display: 'flex',
      alignItems: 'flex-start',
      padding: TavariStyles.spacing.lg,
      border: `2px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.md,
      marginBottom: TavariStyles.spacing.md,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      backgroundColor: TavariStyles.colors.white
    },
    methodOptionHover: {
      borderColor: TavariStyles.colors.primary + '80',
      backgroundColor: TavariStyles.colors.primary + '05'
    },
    methodOptionSelected: {
      borderColor: TavariStyles.colors.primary,
      backgroundColor: TavariStyles.colors.primary + '10'
    },
    radio: {
      marginRight: TavariStyles.spacing.md,
      marginTop: '4px',
      cursor: 'pointer',
      width: '18px',
      height: '18px'
    },
    methodContent: {
      flex: 1
    },
    methodTitle: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.md,
      color: TavariStyles.colors.gray800
    },
    methodDescription: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    formGroup: {
      marginBottom: TavariStyles.spacing.lg
    },
    label: {
      display: 'block',
      marginBottom: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700
    },
    input: {
      width: '100%',
      padding: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.base,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      outline: 'none',
      transition: 'border-color 0.2s ease',
      fontFamily: TavariStyles.typography.fontFamilyMono
    },
    inputFocus: {
      borderColor: TavariStyles.colors.primary
    },
    inputHelp: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs
    },
    success: {
      backgroundColor: TavariStyles.colors.successBg,
      border: `1px solid ${TavariStyles.colors.success}`,
      borderRadius: TavariStyles.borderRadius.md,
      padding: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.lg,
      color: TavariStyles.colors.successText,
      whiteSpace: 'pre-line',
      fontSize: TavariStyles.typography.fontSize.sm,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    error: {
      backgroundColor: TavariStyles.colors.errorBg,
      border: `1px solid ${TavariStyles.colors.danger}`,
      borderRadius: TavariStyles.borderRadius.md,
      padding: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.lg,
      color: TavariStyles.colors.errorText,
      fontSize: TavariStyles.typography.fontSize.sm,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    actions: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      justifyContent: 'flex-end',
      marginTop: TavariStyles.spacing.xl
    },
    button: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      borderRadius: TavariStyles.borderRadius.md,
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      border: 'none',
      outline: 'none'
    },
    cancelButton: {
      backgroundColor: TavariStyles.colors.gray200,
      color: TavariStyles.colors.gray700
    },
    cancelButtonHover: {
      backgroundColor: TavariStyles.colors.gray300
    },
    submitButton: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    submitButtonHover: {
      backgroundColor: TavariStyles.colors.primaryDark
    },
    submitButtonDisabled: {
      opacity: 0.5,
      cursor: 'not-allowed'
    },
    resetButton: {
      backgroundColor: TavariStyles.colors.secondary,
      color: TavariStyles.colors.white,
      marginTop: TavariStyles.spacing.lg,
      width: '100%'
    },
    resetButtonHover: {
      backgroundColor: '#2563eb'
    },
    divider: {
      height: '1px',
      backgroundColor: TavariStyles.colors.gray200,
      margin: `${TavariStyles.spacing.xl} 0`
    }
  };

  return (
    <div style={styles.modal} onClick={handleClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>🔧 Create Auth Account</h2>
          <p style={styles.subtitle}>Fix employee authentication for existing user</p>
        </div>

        <div style={styles.employeeInfo}>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Employee:</span> {employee.full_name}
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Email:</span> {employee.email}
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>User ID:</span> <code>{employee.id}</code>
          </div>
        </div>

        <div style={styles.warningBox}>
          <span style={styles.warningIcon}>⚠️</span>
          <strong>Warning:</strong> This employee exists in the users table but may not have a Supabase Auth account. 
          This tool will create the missing auth account so they can log in.
        </div>

        {success && (
          <div style={styles.success}>
            {success}
          </div>
        )}

        {error && (
          <div style={styles.error}>
            {error}
          </div>
        )}

        {!success && (
          <>
            <div style={styles.methodSelector}>
              <div 
                style={{
                  ...styles.methodOption,
                  ...(method === 'invite' ? styles.methodOptionSelected : {})
                }}
                onClick={() => !loading && setMethod('invite')}
                onMouseEnter={(e) => {
                  if (method !== 'invite' && !loading) {
                    Object.assign(e.currentTarget.style, styles.methodOptionHover);
                  }
                }}
                onMouseLeave={(e) => {
                  if (method !== 'invite') {
                    e.currentTarget.style.borderColor = TavariStyles.colors.gray200;
                    e.currentTarget.style.backgroundColor = TavariStyles.colors.white;
                  }
                }}
              >
                <input 
                  type="radio" 
                  checked={method === 'invite'} 
                  onChange={() => !loading && setMethod('invite')}
                  style={styles.radio}
                  disabled={loading}
                />
                <div style={styles.methodContent}>
                  <div style={styles.methodTitle}>📧 Send Invite Email (Recommended)</div>
                  <div style={styles.methodDescription}>
                    Employee receives an email to set their own password. More secure and employee-friendly. 
                    The invite link is valid for 24 hours.
                  </div>
                </div>
              </div>

              <div 
                style={{
                  ...styles.methodOption,
                  ...(method === 'password' ? styles.methodOptionSelected : {})
                }}
                onClick={() => !loading && setMethod('password')}
                onMouseEnter={(e) => {
                  if (method !== 'password' && !loading) {
                    Object.assign(e.currentTarget.style, styles.methodOptionHover);
                  }
                }}
                onMouseLeave={(e) => {
                  if (method !== 'password') {
                    e.currentTarget.style.borderColor = TavariStyles.colors.gray200;
                    e.currentTarget.style.backgroundColor = TavariStyles.colors.white;
                  }
                }}
              >
                <input 
                  type="radio" 
                  checked={method === 'password'} 
                  onChange={() => !loading && setMethod('password')}
                  style={styles.radio}
                  disabled={loading}
                />
                <div style={styles.methodContent}>
                  <div style={styles.methodTitle}>🔐 Set Temporary Password</div>
                  <div style={styles.methodDescription}>
                    Create account with a temporary password. You must share it securely with the employee. 
                    Employee should change it immediately after first login.
                  </div>
                </div>
              </div>
            </div>

            {method === 'password' && (
              <div style={styles.formGroup}>
                <label style={styles.label}>Temporary Password *</label>
                <input
                  type="text"
                  value={temporaryPassword}
                  onChange={(e) => setTemporaryPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  style={styles.input}
                  disabled={loading}
                  onFocus={(e) => e.target.style.borderColor = TavariStyles.colors.primary}
                  onBlur={(e) => e.target.style.borderColor = TavariStyles.colors.gray300}
                />
                <p style={styles.inputHelp}>
                  ⚠️ Employee must change this password on first login
                </p>
              </div>
            )}

            <div style={styles.actions}>
              <button
                onClick={handleClose}
                style={{
                  ...styles.button,
                  ...styles.cancelButton
                }}
                disabled={loading}
                onMouseEnter={(e) => {
                  if (!loading) {
                    Object.assign(e.currentTarget.style, styles.cancelButtonHover);
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = TavariStyles.colors.gray200;
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateAuthAccount}
                style={{
                  ...styles.button,
                  ...styles.submitButton,
                  ...(loading || (method === 'password' && !temporaryPassword) ? styles.submitButtonDisabled : {})
                }}
                disabled={loading || (method === 'password' && !temporaryPassword)}
                onMouseEnter={(e) => {
                  if (!loading && !(method === 'password' && !temporaryPassword)) {
                    Object.assign(e.currentTarget.style, styles.submitButtonHover);
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading) {
                    e.currentTarget.style.backgroundColor = TavariStyles.colors.primary;
                  }
                }}
              >
                {loading ? '⏳ Creating...' : '✅ Create Auth Account'}
              </button>
            </div>

            <div style={styles.divider} />

            <button
              onClick={handlePasswordReset}
              style={{
                ...styles.button,
                ...styles.resetButton
              }}
              disabled={loading}
              onMouseEnter={(e) => {
                if (!loading) {
                  Object.assign(e.currentTarget.style, styles.resetButtonHover);
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = TavariStyles.colors.secondary;
              }}
            >
              🔓 Or Send Password Reset Email (if auth exists)
            </button>
          </>
        )}

        {success && (
          <div style={styles.actions}>
            <button
              onClick={handleClose}
              style={{
                ...styles.button,
                ...styles.submitButton,
                width: '100%'
              }}
              onMouseEnter={(e) => {
                Object.assign(e.currentTarget.style, styles.submitButtonHover);
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = TavariStyles.colors.primary;
              }}
            >
              ✅ Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FixEmployeeAuthModal;