// PortalPasswordReset.jsx - Handle custom password reset
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { hashValue } from '../../helpers/crypto';
import { verifyPasswordResetToken } from '../../utils/passwordReset';

const PortalPasswordReset = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);

  useEffect(() => {
    // Check for custom reset token in query params
    const searchParams = new URLSearchParams(window.location.search);
    const token = searchParams.get('token');
    
    // Also support legacy Supabase hash-based tokens for backward compatibility
    const hash = window.location.hash.substring(1);
    
    if (token) {
      // Custom token flow
      console.log('🔍 Reset page - Custom token found');
      handleCustomToken(token);
    } else if (hash) {
      // Legacy Supabase hash-based token (for backward compatibility)
      console.log('🔍 Reset page - Legacy Supabase token found');
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get('access_token');
      const type = hashParams.get('type');
      const refreshToken = hashParams.get('refresh_token') || '';

      if (type === 'recovery' && accessToken) {
        handleSupabaseToken(accessToken, refreshToken);
      } else {
        console.log('❌ Invalid legacy token format');
        setError('Invalid reset link. Please request a new password reset.');
        setLoading(false);
      }
    } else {
      console.log('❌ No token found');
      setError('Invalid reset link. Please request a new password reset.');
      setLoading(false);
    }
  }, []);

  const handleCustomToken = async (token) => {
    try {
      console.log('🔄 Verifying custom reset token...');
      const result = await verifyPasswordResetToken(token);

      if (!result.success) {
        setError(result.error || 'Invalid or expired reset link. Please request a new password reset.');
        setLoading(false);
        return;
      }

      // Token verification already confirms the user exists
      // Store token and user_id for later verification on submit
      console.log('✅ Token verified successfully for user:', result.email);
      sessionStorage.setItem('password_reset_token', token);
      sessionStorage.setItem('password_reset_user_id', result.user_id);
      setLoading(false);
    } catch (err) {
      console.error('❌ Exception verifying token:', err);
      setError('Invalid or expired reset link. Please request a new password reset.');
      setLoading(false);
    }
  };

  const handleSupabaseToken = async (accessToken, refreshToken) => {
    try {
      console.log('🔄 Setting session from Supabase token...');
      // Exchange the access token for a session (legacy flow)
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });

      if (error) {
        console.error('❌ Error setting session:', error);
        setError('Invalid or expired reset link. Please request a new password reset.');
        setLoading(false);
      } else {
        console.log('✅ Session set successfully:', data.session?.user?.email);
        setLoading(false);
      }
    } catch (err) {
      console.error('❌ Exception setting session:', err);
      setError('Invalid or expired reset link. Please request a new password reset.');
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log('🚀 Password reset form submitted');
    setError('');
    setSubmitting(true);

    try {
      // Validation
      if (!password || password.length < 6) {
        setError('Password must be at least 6 characters');
        setSubmitting(false);
        return;
      }

      if (password !== confirmPassword) {
        setError('Passwords do not match');
        setSubmitting(false);
        return;
      }

      if (!pin || pin.length < 4) {
        setError('PIN must be at least 4 digits');
        setSubmitting(false);
        return;
      }

      if (!/^\d+$/.test(pin)) {
        setError('PIN must contain only numbers');
        setSubmitting(false);
        return;
      }

      console.log('✅ Validation passed');

      // Check if we're using custom token flow
      const customToken = sessionStorage.getItem('password_reset_token');
      const customUserId = sessionStorage.getItem('password_reset_user_id');
      console.log('🔑 Token check:', { hasToken: !!customToken, hasUserId: !!customUserId });
      
      let session = null;
      let userId = null;

      if (customToken && customUserId) {
        console.log('🔄 Custom token flow - hashing password and PIN');
        // Hash password and PIN before sending to edge function
        const hashedPassword = await hashValue(password);
        const hashedPin = await hashValue(pin);
        console.log('✅ Password and PIN hashed');

        // Custom token flow - update password via edge function
        // Use fetch directly (user isn't logged in, so can't use supabase.functions.invoke)
        try {
          console.log('📡 Calling update-password-via-token edge function...');
          const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-password-via-token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({
              token: customToken,
              newPassword: password,
              hashedPassword: hashedPassword,
              hashedPin: hashedPin
            })
          });

          console.log('📥 Response status:', response.status, response.statusText);
          if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Edge function error response:', errorText);
            let errorMessage = 'Failed to update password. Please try again.';
            try {
              const errorData = JSON.parse(errorText);
              errorMessage = errorData.error || errorMessage;
            } catch (e) {
              errorMessage = `Failed to update password (${response.status}). Please try again.`;
            }
            setError(errorMessage);
            setSubmitting(false);
            return;
          }

          const updateData = await response.json();
          console.log('✅ Edge function response:', updateData);

          if (!updateData?.success) {
            console.error('❌ Edge function returned success:false:', updateData);
            setError(updateData?.error || 'Failed to update password. Please try again.');
            setSubmitting(false);
            return;
          }

          // Edge function returns email, so we don't need to query users table
          const userEmail = updateData.email;
          console.log('📧 User email from response:', userEmail);

          if (!userEmail) {
            console.error('❌ No email in response');
            setError('Password updated, but failed to get user email. Please try logging in manually.');
            setSubmitting(false);
            return;
          }

          // Sign in with new password
          console.log('🔐 Signing in with new password...');
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: userEmail,
            password: password
          });

          if (signInError) {
            console.error('❌ Sign in error:', signInError);
            setError('Password updated, but failed to sign in. Please try logging in manually.');
            setSubmitting(false);
            return;
          }

          console.log('✅ Signed in successfully');
          session = signInData.session;
          userId = customUserId;

          // Clear stored tokens
          sessionStorage.removeItem('password_reset_token');
          sessionStorage.removeItem('password_reset_user_id');
        } catch (fetchError) {
          console.error('Error calling update-password-via-token:', fetchError);
          setError('Network error. Please check your connection and try again.');
          setSubmitting(false);
          return;
        }
      } else {
        // Legacy Supabase token flow
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          setError('Session expired. Please request a new password reset.');
          setSubmitting(false);
          return;
        }
        session = sessionData.session;
        userId = session.user.id;

        // Update Supabase Auth password
        const { error: updateError } = await supabase.auth.updateUser({
          password: password
        });

        if (updateError) {
          if (updateError.message && updateError.message.includes('should be different')) {
            console.log('Password is already set to this value - continuing with PIN update');
          } else {
            console.error('Error updating auth password:', updateError);
            setError('Failed to update password. Please try again.');
            setSubmitting(false);
            return;
          }
        }
      }

      // For custom token flow, edge function already updated users table
      // For legacy flow, update users table here
      if (!customToken) {
        // Hash password and PIN
        const hashedPassword = await hashValue(password);
        const hashedPin = await hashValue(pin);

        // Update user record in database
        const { error: dbError } = await supabase
          .from('users')
          .update({
            hashed_password: hashedPassword,
            pin: hashedPin,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);

        if (dbError) {
          console.error('Error updating user record:', dbError);
          setError('Password updated, but failed to save PIN. Please contact support.');
          setSubmitting(false);
          return;
        }
      }

      console.log('✅ Password reset complete!');
      toast.success('Password and PIN reset successfully!');
      
      // Redirect to login
      setTimeout(() => {
        console.log('🔄 Redirecting to login...');
        navigate('/portal/login', { replace: true });
      }, 1500);

    } catch (err) {
      console.error('❌ Error resetting password:', err);
      console.error('❌ Error stack:', err.stack);
      setError('An error occurred. Please try again.');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: TavariStyles.colors.gray50
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', color: TavariStyles.colors.gray700 }}>
            Verifying reset link...
          </div>
        </div>
      </div>
    );
  }

  const styles = {
    container: {
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.xl
    },
    card: {
      width: '100%',
      maxWidth: '420px',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.xl || '16px',
      padding: TavariStyles.spacing['2xl'],
      boxShadow: TavariStyles.shadows?.lg || '0 10px 40px rgba(0,0,0,0.1)'
    },
    header: {
      textAlign: 'center',
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.lg
    },
    inputGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700
    },
    input: {
      width: '100%',
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      boxSizing: 'border-box'
    },
    passwordWrapper: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center'
    },
    passwordToggle: {
      position: 'absolute',
      right: TavariStyles.spacing.md,
      background: 'none',
      border: 'none',
      color: TavariStyles.colors.gray500,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      padding: TavariStyles.spacing.xs
    },
    errorMsg: {
      backgroundColor: TavariStyles.colors.danger + '15',
      color: TavariStyles.colors.danger,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.sm,
      textAlign: 'center'
    },
    button: {
      width: '100%',
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: submitting ? 'not-allowed' : 'pointer',
      opacity: submitting ? 0.7 : 1
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>Reset Password</h1>
          <p style={styles.subtitle}>Enter your new password and PIN</p>
        </div>

        {error && (
          <div style={styles.errorMsg}>{error}</div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <label htmlFor="password" style={styles.label}>New Password *</label>
            <div style={styles.passwordWrapper}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                disabled={submitting}
                style={{ ...styles.input, paddingRight: '48px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={styles.passwordToggle}
                tabIndex={-1}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div style={styles.inputGroup}>
            <label htmlFor="confirmPassword" style={styles.label}>Confirm Password *</label>
            <div style={styles.passwordWrapper}>
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
                disabled={submitting}
                style={{ ...styles.input, paddingRight: '48px' }}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                style={styles.passwordToggle}
                tabIndex={-1}
              >
                {showConfirmPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div style={styles.inputGroup}>
            <label htmlFor="pin" style={styles.label}>PIN (4+ digits) *</label>
            <div style={styles.passwordWrapper}>
              <input
                id="pin"
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter PIN (numbers only)"
                required
                disabled={submitting}
                maxLength={10}
                style={{ ...styles.input, paddingRight: '48px' }}
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                style={styles.passwordToggle}
                tabIndex={-1}
              >
                {showPin ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={styles.button}
          >
            {submitting ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PortalPasswordReset;

