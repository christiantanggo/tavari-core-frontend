// src/screens/ForgotPassword.jsx - SYNTAX ERROR FIXED
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { SecurityWrapper, useSecurityContext } from '../Security';
import { TavariStyles } from '../utils/TavariStyles';
import toast from 'react-hot-toast';
import bcrypt from 'bcryptjs';

const ForgotPassword = () => {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [userId, setUserId] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Security context for password reset operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'ForgotPassword',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  const handleVerify = async () => {
    setErrorMsg('');
    setLoading(true);

    try {
      // Rate limiting: 5 verification attempts per 5 minutes
      const rateLimitOk = await checkRateLimit('password_reset_verify', 5, 300000);
      if (!rateLimitOk) {
        setErrorMsg('Too many verification attempts. Please wait 5 minutes.');
        await logSecurityEvent('password_reset_rate_limit_exceeded', {
          email,
          step: 'verify'
        }, 'high');
        return;
      }

      // Validate inputs
      const emailValidation = validateInput(email, 'email', { required: true });
      if (!emailValidation.isValid) {
        setErrorMsg(emailValidation.error);
        return;
      }

      const pinValidation = validateInput(pin, 'pin', { required: true, minLength: 4, maxLength: 4 });
      if (!pinValidation.isValid) {
        setErrorMsg(pinValidation.error);
        return;
      }

      await recordAction('password_reset_verify_attempt', email, true);

      // Step 1: Get user by email
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, email, pin')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();

      if (userError || !user) {
        await logSecurityEvent('password_reset_user_not_found', {
          email,
          error: userError?.message
        }, 'medium');
        setErrorMsg('User not found or invalid information.');
        return;
      }

      // Step 2: Verify PIN (handle both hashed and plain PINs)
      let pinValid = false;

      if (user.pin.startsWith('$2b$') || user.pin.startsWith('$2a$')) {
        // Hashed PIN - use bcrypt
        pinValid = await bcrypt.compare(pin, user.pin);
      } else {
        // Plain PIN
        pinValid = String(pin).trim() === String(user.pin).trim();
      }

      if (!pinValid) {
        await logSecurityEvent('password_reset_incorrect_pin', {
          email,
          user_id: user.id
        }, 'high');
        setErrorMsg('Invalid PIN. Please try again.');
        return;
      }

      await logSecurityEvent('password_reset_verified', {
        email,
        user_id: user.id
      }, 'high');

      setUserId(user.id);
      setStep(2);
      toast.success('Verification successful. Enter your new password.');

    } catch (error) {
      await logSecurityEvent('password_reset_verify_error', {
        email,
        error: error.message
      }, 'high');
      setErrorMsg('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setErrorMsg('');
    setLoading(true);

    try {
      // Rate limiting: 3 password reset attempts per 5 minutes
      const rateLimitOk = await checkRateLimit('password_reset_execute', 3, 300000);
      if (!rateLimitOk) {
        setErrorMsg('Too many reset attempts. Please wait 5 minutes.');
        await logSecurityEvent('password_reset_execute_rate_limit', {
          user_id: userId,
          email
        }, 'critical');
        return;
      }

      // Validate password
      const passwordValidation = validateInput(newPassword, 'password', { 
        required: true, 
        minLength: 6 
      });
      if (!passwordValidation.isValid) {
        setErrorMsg(passwordValidation.error);
        return;
      }

      if (newPassword !== confirmPassword) {
        setErrorMsg('Passwords do not match.');
        return;
      }

      await recordAction('password_reset_execute_attempt', userId, true);

      // Call the Edge Function to reset password
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-reset-password`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({
            employee_email: email,
            new_password: newPassword,
            forgot_password_flow: true,
            user_id: userId,
            pin_verified: true
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Password reset failed');
      }

      await logSecurityEvent('password_reset_completed', {
        user_id: userId,
        email,
        method: 'forgot_password_flow'
      }, 'critical');

      toast.success('✅ Password reset successfully! You can now log in.');
      navigate('/login');

    } catch (error) {
      await logSecurityEvent('password_reset_execute_error', {
        user_id: userId,
        email,
        error: error.message
      }, 'critical');
      setErrorMsg('Failed to reset password. Please try again or contact support.');
    } finally {
      setLoading(false);
    }
  };

  const styles = {
    container: {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.xl
    },
    card: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      boxShadow: TavariStyles.shadows?.lg || '0 10px 25px rgba(0,0,0,0.1)',
      padding: TavariStyles.spacing['3xl'],
      width: '100%',
      maxWidth: '450px',
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm,
      textAlign: 'center'
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing['2xl'],
      textAlign: 'center',
      lineHeight: '1.5'
    },
    inputGroup: {
      marginBottom: TavariStyles.spacing.lg
    },
    label: {
      display: 'block',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs
    },
    input: {
      width: '100%',
      padding: '12px 16px',
      fontSize: TavariStyles.typography.fontSize.md,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      outline: 'none',
      transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
      boxSizing: 'border-box'
    },
    button: {
      width: '100%',
      padding: '14px',
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      cursor: loading ? 'not-allowed' : 'pointer',
      marginTop: TavariStyles.spacing.lg,
      transition: 'background-color 0.2s ease, opacity 0.2s ease',
      opacity: loading ? 0.6 : 1
    },
    error: {
      color: TavariStyles.colors.danger,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginTop: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.errorBg,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      border: `1px solid ${TavariStyles.colors.danger}`,
      textAlign: 'center'
    },
    backLink: {
      display: 'block',
      textAlign: 'center',
      marginTop: TavariStyles.spacing.lg,
      color: TavariStyles.colors.primary,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      textDecoration: 'none',
      cursor: 'pointer',
      transition: 'color 0.2s ease'
    },
    progressSteps: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing['2xl'],
      gap: TavariStyles.spacing.md
    },
    step: {
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      fontSize: TavariStyles.typography.fontSize.sm,
      transition: 'all 0.3s ease'
    },
    stepActive: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    stepInactive: {
      backgroundColor: TavariStyles.colors.gray200,
      color: TavariStyles.colors.gray500
    },
    stepConnector: {
      width: '50px',
      height: '2px',
      backgroundColor: TavariStyles.colors.gray200
    }
  };

  return (
    <SecurityWrapper>
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.title}>Forgot Password</h2>
          
          {/* Progress Steps */}
          <div style={styles.progressSteps}>
            <div style={{
              ...styles.step,
              ...(step === 1 ? styles.stepActive : styles.stepInactive)
            }}>
              1
            </div>
            <div style={styles.stepConnector}></div>
            <div style={{
              ...styles.step,
              ...(step === 2 ? styles.stepActive : styles.stepInactive)
            }}>
              2
            </div>
          </div>

          {step === 1 && (
            <>
              <p style={styles.subtitle}>
                Enter your email address and PIN to verify your identity.
              </p>
              
              <div style={styles.inputGroup}>
                <label style={styles.label}>Email Address</label>
                <input
                  style={styles.input}
                  type="email"
                  placeholder="your.email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  onFocus={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.primary;
                    e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.gray300;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>PIN (4 digits)</label>
                <input
                  style={styles.input}
                  type="password"
                  placeholder="Enter your 4-digit PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  maxLength={4}
                  disabled={loading}
                  onFocus={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.primary;
                    e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.gray300;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <button 
                style={styles.button} 
                onClick={handleVerify}
                disabled={loading}
                onMouseOver={(e) => {
                  if (!loading) e.target.style.backgroundColor = TavariStyles.colors.primaryHover || '#0d7377';
                }}
                onMouseOut={(e) => {
                  e.target.style.backgroundColor = TavariStyles.colors.primary;
                }}
              >
                {loading ? 'Verifying...' : 'Verify Identity'}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <p style={styles.subtitle}>
                Identity verified! Enter your new password below.
              </p>

              <div style={styles.inputGroup}>
                <label style={styles.label}>New Password</label>
                <input
                  style={styles.input}
                  type="password"
                  placeholder="Enter new password (min. 6 characters)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                  onFocus={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.primary;
                    e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.gray300;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>Confirm New Password</label>
                <input
                  style={styles.input}
                  type="password"
                  placeholder="Re-enter your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  onFocus={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.primary;
                    e.target.style.boxShadow = `0 0 0 3px ${TavariStyles.colors.primary}20`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.gray300;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              <button 
                style={styles.button} 
                onClick={handleResetPassword}
                disabled={loading}
                onMouseOver={(e) => {
                  if (!loading) e.target.style.backgroundColor = TavariStyles.colors.primaryHover || '#0d7377';
                }}
                onMouseOut={(e) => {
                  e.target.style.backgroundColor = TavariStyles.colors.primary;
                }}
              >
                {loading ? 'Resetting Password...' : 'Reset Password'}
              </button>
            </>
          )}

          {errorMsg && <div style={styles.error}>{errorMsg}</div>}

          <span
            style={styles.backLink}
            onClick={() => navigate('/login')}
            onMouseOver={(e) => {
              e.target.style.color = TavariStyles.colors.primaryHover || '#0d7377';
            }}
            onMouseOut={(e) => {
              e.target.style.color = TavariStyles.colors.primary;
            }}
          >
            ← Back to Login
          </span>
        </div>
      </div>
    </SecurityWrapper>
  );
};

export default ForgotPassword;