// PasswordChangeModal.jsx - Modal to force password/PIN change
import React, { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { hashValue } from '../../helpers/crypto';
import toast from 'react-hot-toast';
import { Eye, EyeOff, X } from 'lucide-react';
import { getPublicUserId } from '../../utils/getPublicUserId';

const PasswordChangeModal = ({ onComplete }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pin, setPin] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!pin || pin.length < 4 || !/^\d+$/.test(pin)) {
      setError('PIN must be 4 digits');
      return;
    }

    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Session expired');
      }

      const hashedPassword = await hashValue(password);
      const hashedPin = await hashValue(pin);

      // Update auth password
      const { error: authError } = await supabase.auth.updateUser({
        password: password
      });

      if (authError && !authError.message?.includes('should be different')) {
        throw authError;
      }

      const publicUserId = (await getPublicUserId(session.user.email)) || session.user.id;

      // Update user record (public.users — may differ from auth id on legacy accounts)
      const { error: updateError } = await supabase
        .from('users')
        .update({
          hashed_password: hashedPassword,
          pin: hashedPin,
          updated_at: new Date().toISOString()
        })
        .eq('id', publicUserId);

      if (updateError) throw updateError;

      toast.success('Password and PIN updated!');
      onComplete();
    } catch (err) {
      console.error('Error updating password:', err);
      setError(err.message || 'Failed to update password');
      setSubmitting(false);
    }
  };

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: TavariStyles.spacing.lg
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.xl || '12px',
      width: '100%',
      maxWidth: '500px',
      boxShadow: TavariStyles.shadows?.xl || '0 20px 25px -5px rgba(0,0,0,0.1)'
    },
    header: {
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      margin: 0
    },
    body: {
      padding: TavariStyles.spacing.xl
    },
    inputGroup: {
      marginBottom: TavariStyles.spacing.lg
    },
    label: {
      display: 'block',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs
    },
    inputWrapper: {
      position: 'relative'
    },
    input: {
      width: '100%',
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      paddingRight: '48px'
    },
    eyeButton: {
      position: 'absolute',
      right: '12px',
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: TavariStyles.colors.gray600,
      padding: '4px'
    },
    error: {
      color: TavariStyles.colors.danger,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginBottom: TavariStyles.spacing.md
    },
    footer: {
      padding: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'flex-end',
      gap: TavariStyles.spacing.md
    },
    button: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      transition: 'all 0.2s'
    },
    buttonPrimary: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>Change Your Password</h2>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={styles.body}>
            {error && <div style={styles.error}>{error}</div>}
            
            <div style={styles.inputGroup}>
              <label style={styles.label}>New Password *</label>
              <div style={styles.inputWrapper}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  required
                  disabled={submitting}
                  style={styles.input}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={styles.eyeButton}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Confirm Password *</label>
              <div style={styles.inputWrapper}>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  required
                  disabled={submitting}
                  style={styles.input}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={styles.eyeButton}
                >
                  {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>PIN (4 digits) *</label>
              <div style={styles.inputWrapper}>
                <input
                  type={showPin ? 'text' : 'password'}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="0000"
                  maxLength={4}
                  required
                  disabled={submitting}
                  style={styles.input}
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  style={styles.eyeButton}
                >
                  {showPin ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>
          </div>
          <div style={styles.footer}>
            <button
              type="submit"
              disabled={submitting}
              style={{ ...styles.button, ...styles.buttonPrimary }}
            >
              {submitting ? 'Saving...' : 'Save Password & PIN'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PasswordChangeModal;








