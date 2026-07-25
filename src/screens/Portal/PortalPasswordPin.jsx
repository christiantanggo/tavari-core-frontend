// PortalPasswordPin.jsx - Employee Portal Password & PIN Update
import React, { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { hashValue } from '../../helpers/crypto';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Lock, Key } from 'lucide-react';
import { getPublicUserId } from '../../utils/getPublicUserId';

const PortalPasswordPin = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validate current password
    if (!currentPassword || currentPassword.length < 6) {
      setError('Please enter your current password');
      return;
    }

    // Validate password if provided
    if (newPassword) {
      if (newPassword.length < 6) {
        setError('Password must be at least 6 characters');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }

    // Validate PIN if provided
    if (newPin) {
      if (newPin.length < 4 || !/^\d+$/.test(newPin)) {
        setError('PIN must be 4 digits');
        return;
      }
      if (newPin !== confirmPin) {
        setError('PINs do not match');
        return;
      }
    }

    // Must update at least one
    if (!newPassword && !newPin) {
      setError('Please enter a new password and/or PIN');
      return;
    }

    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Session expired. Please log in again.');
      }

      // Get public user ID
      const publicUserId = await getPublicUserId(session.user.email);
      if (!publicUserId) {
        throw new Error('User profile not found');
      }

      // Verify current password by attempting to sign in
      // This ensures the password is correct before allowing changes
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: session.user.email,
        password: currentPassword
      });

      if (signInError) {
        setError('Incorrect current password');
        setSubmitting(false);
        return;
      }

      // Re-get session after sign-in (it may have been refreshed)
      const { data: { session: newSession } } = await supabase.auth.getSession();
      if (!newSession) {
        throw new Error('Session expired. Please log in again.');
      }

      // Update password if provided
      if (newPassword) {
        const { error: authError } = await supabase.auth.updateUser({
          password: newPassword
        });

        if (authError && !authError.message?.includes('should be different')) {
          throw new Error('Failed to update password: ' + authError.message);
        }

        // Update hashed password in users table
        const hashedPassword = await hashValue(newPassword);
        const { error: updatePasswordError } = await supabase
          .from('users')
          .update({ hashed_password: hashedPassword })
          .eq('id', publicUserId);

        if (updatePasswordError) {
          console.error('Error updating password in users table:', updatePasswordError);
          // Don't throw - auth password was updated, this is just a sync issue
        }
      }

      // Update PIN if provided
      if (newPin) {
        const hashedPin = await hashValue(newPin);
        const { error: updatePinError } = await supabase
          .from('users')
          .update({ pin: hashedPin })
          .eq('id', publicUserId);

        if (updatePinError) {
          throw new Error('Failed to update PIN: ' + updatePinError.message);
        }
      }

      toast.success('Password and/or PIN updated successfully!');
      
      // Clear form
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNewPin('');
      setConfirmPin('');
      setError('');
    } catch (err) {
      console.error('Error updating password/PIN:', err);
      setError(err.message || 'Failed to update password/PIN');
    } finally {
      setSubmitting(false);
    }
  };

  const styles = {
    container: {
      maxWidth: '600px',
      width: '100%',
      minWidth: 0,
      margin: '0 auto',
      padding: TavariStyles.spacing.xl,
      overflowX: 'hidden',
      boxSizing: 'border-box'
    },
    header: {
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600
    },
    card: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      boxSizing: 'border-box',
      overflowWrap: 'anywhere'
    },
    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.lg
    },
    section: {
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxSizing: 'border-box',
      minWidth: 0
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.md,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    inputGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs,
      marginBottom: TavariStyles.spacing.md
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700
    },
    inputWrapper: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center'
    },
    input: {
      width: '100%',
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      backgroundColor: TavariStyles.colors.white,
      transition: 'border-color 0.2s',
      boxSizing: 'border-box',
      paddingRight: '45px'
    },
    inputFocus: {
      outline: 'none',
      borderColor: TavariStyles.colors.primary,
      boxShadow: `0 0 0 3px ${TavariStyles.colors.primary}20`
    },
    toggleButton: {
      position: 'absolute',
      right: TavariStyles.spacing.md,
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: TavariStyles.colors.gray600,
      display: 'flex',
      alignItems: 'center',
      padding: TavariStyles.spacing.xs
    },
    errorText: {
      color: TavariStyles.colors.error || '#ef4444',
      fontSize: TavariStyles.typography.fontSize.sm,
      marginTop: TavariStyles.spacing.xs
    },
    submitButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: submitting ? 'not-allowed' : 'pointer',
      opacity: submitting ? 0.6 : 1,
      transition: 'all 0.2s'
    },
    helpText: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Update Password & PIN</h1>
        <p style={styles.subtitle}>Change your password and/or PIN. You can update one or both.</p>
      </div>

      <div style={styles.card}>
        <form style={styles.form} onSubmit={handleSubmit}>
          {/* Current Password Verification */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>
              <Lock size={18} />
              Current Password (Required)
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Enter your current password to verify your identity</label>
              <div style={styles.inputWrapper}>
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter your current password"
                  style={styles.input}
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  style={styles.toggleButton}
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                >
                  {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p style={styles.helpText}>This is the password you used to log in</p>
            </div>
          </div>

          {/* Password Update Section */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>
              <Lock size={18} />
              Update Password (Optional)
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>New Password</label>
              <div style={styles.inputWrapper}>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Leave blank to keep current password"
                  style={styles.input}
                  minLength={6}
                />
                <button
                  type="button"
                  style={styles.toggleButton}
                  onClick={() => setShowNewPassword(!showNewPassword)}
                >
                  {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p style={styles.helpText}>Must be at least 6 characters</p>
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Confirm New Password</label>
              <div style={styles.inputWrapper}>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  style={styles.input}
                  minLength={6}
                />
                <button
                  type="button"
                  style={styles.toggleButton}
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
          </div>

          {/* PIN Update Section */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>
              <Key size={18} />
              Update PIN (Optional)
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>New PIN</label>
              <div style={styles.inputWrapper}>
                <input
                  type={showNewPin ? 'text' : 'password'}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Leave blank to keep current PIN"
                  style={styles.input}
                  maxLength={4}
                />
                <button
                  type="button"
                  style={styles.toggleButton}
                  onClick={() => setShowNewPin(!showNewPin)}
                >
                  {showNewPin ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p style={styles.helpText}>Must be 4 digits</p>
            </div>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Confirm New PIN</label>
              <div style={styles.inputWrapper}>
                <input
                  type={showConfirmPin ? 'text' : 'password'}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Confirm new PIN"
                  style={styles.input}
                  maxLength={4}
                />
                <button
                  type="button"
                  style={styles.toggleButton}
                  onClick={() => setShowConfirmPin(!showConfirmPin)}
                >
                  {showConfirmPin ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div style={styles.errorText}>{error}</div>
          )}

          <button
            type="submit"
            style={styles.submitButton}
            disabled={submitting}
          >
            {submitting ? 'Updating...' : 'Update Password & PIN'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PortalPasswordPin;

