// PortalPasswordSetup.jsx - Force employees to create password and PIN on first login
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { hashValue } from '../../helpers/crypto';
import { Eye, EyeOff, Lock, Key } from 'lucide-react';
import { getPublicUserId } from '../../utils/getPublicUserId';

const PortalPasswordSetup = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
    pin: ''
  });
  
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);

  useEffect(() => {
    checkSetupNeeded();
  }, []);

  const checkSetupNeeded = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      // Check if email is stored (first-time login without session)
      const storedEmail = sessionStorage.getItem('portal_setup_email');
      
      if (!session && !storedEmail) {
        // No session and no stored email - redirect to login
        navigate('/portal/login');
        return;
      }

      let userData = null;
      let userId = null;

      if (session) {
        const publicUserId = await getPublicUserId(session.user.email);
        if (!publicUserId) {
          setError('Your profile could not be loaded. Please sign out and sign in again.');
          setLoading(false);
          return;
        }
        const { data: user, error: userError } = await supabase
          .from('users')
          .select('id, hashed_password, pin, email')
          .eq('id', publicUserId)
          .single();

        if (userError) {
          console.error('Error checking user data:', userError);
          setError('Failed to load user data. Please try again.');
          return;
        }

        userData = user;
        userId = user?.id;
      } else if (storedEmail) {
        // No session but email stored - first time login
        // Look up user by email
        const { data: user, error: userError } = await supabase
          .from('users')
          .select('id, hashed_password, pin, email')
          .eq('email', storedEmail.toLowerCase().trim())
          .maybeSingle();

        if (userError) {
          console.error('Error checking user data:', userError);
          setError('Failed to load user data. Please try again.');
          return;
        }

        if (!user) {
          setError('No account found with this email. Please contact HR.');
          sessionStorage.removeItem('portal_setup_email');
          setTimeout(() => navigate('/portal/login'), 2000);
          return;
        }

        userData = user;
        userId = user.id;
      }

      // If both password and PIN exist, redirect to portal (if logged in) or login
      if (userData?.hashed_password && userData?.pin) {
        if (session) {
          navigate('/portal', { replace: true });
        } else {
          sessionStorage.removeItem('portal_setup_email');
          navigate('/portal/login', { replace: true });
          toast.info('Password already set. Please log in.');
        }
        return;
      }

      setLoading(false);
    } catch (err) {
      console.error('Error checking setup status:', err);
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      // Validation
      if (!formData.password || formData.password.length < 6) {
        setError('Password must be at least 6 characters');
        return;
      }

      if (formData.password !== formData.confirmPassword) {
        setError('Passwords do not match');
        return;
      }

      if (!formData.pin || formData.pin.length < 4) {
        setError('PIN must be at least 4 digits');
        return;
      }

      if (!/^\d+$/.test(formData.pin)) {
        setError('PIN must contain only numbers');
        return;
      }

      // Get email from session or sessionStorage
      const storedEmail = sessionStorage.getItem('portal_setup_email');
      const { data: { session } } = await supabase.auth.getSession();
      
      let userId = null;
      let userEmail = null;
      let userFirstName = null;
      let userLastName = null;

      if (session) {
        const publicUserId = await getPublicUserId(session.user.email);
        if (!publicUserId) {
          setError('Could not resolve your profile. Please sign out and sign in again.');
          return;
        }
        userId = publicUserId;
        const { data: userData, error: userFetchError } = await supabase
          .from('users')
          .select('email, first_name, last_name')
          .eq('id', publicUserId)
          .single();

        if (userFetchError) {
          console.error('Error fetching user data:', userFetchError);
          setError('Failed to load user data. Please try again.');
          return;
        }

        userEmail = userData.email;
        userFirstName = userData.first_name;
        userLastName = userData.last_name;
      } else if (storedEmail) {
        // First time login - look up user by email
        const { data: userData, error: userFetchError } = await supabase
          .from('users')
          .select('id, email, first_name, last_name')
          .eq('email', storedEmail.toLowerCase().trim())
          .maybeSingle();

        if (userFetchError || !userData) {
          console.error('Error fetching user data:', userFetchError);
          setError('Failed to load user data. Please try again.');
          return;
        }

        userId = userData.id;
        userEmail = userData.email;
        userFirstName = userData.first_name;
        userLastName = userData.last_name;
      } else {
        setError('Session expired. Please log in again.');
        navigate('/portal/login');
        return;
      }

      // Hash password and PIN
      const hashedPassword = await hashValue(formData.password);
      const hashedPin = await hashValue(formData.pin);

      // Update user record
      const { data: updatedRows, error: updateError } = await supabase
        .from('users')
        .update({
          hashed_password: hashedPassword,
          pin: hashedPin,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select('id');

      if (updateError) {
        console.error('Error updating password/PIN:', updateError);
        setError('Failed to save password and PIN. Please try again.');
        return;
      }
      if (!updatedRows?.length) {
        setError('Could not save your password (profile not updated). Try signing out and back in.');
        return;
      }

      // CRITICAL: Set Supabase Auth password
      // The auth account was created via invite when the contract was sent, but no password is set yet
      // We need to send a custom password reset email so the user can set their auth password
      console.log('Sending custom password reset email to set auth password...');
      const { requestPasswordReset } = await import('../../utils/passwordReset');
      const result = await requestPasswordReset(userEmail);
      
      if (!result.success) {
        console.error('Failed to send password reset email');
        setError('Failed to send password setup email. Please use "Forgot Password" on the login page.');
        return;
      }
      
      // Clear stored email
      sessionStorage.removeItem('portal_setup_email');

      toast.success('Password and PIN saved! Check your email for a link to set your login password.');
      
      // Redirect to login - user needs to check email and use the password reset link
      setTimeout(() => {
        navigate('/portal/login', { replace: true });
      }, 2000);

    } catch (err) {
      console.error('Error setting password/PIN:', err);
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

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
      maxWidth: '500px',
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
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.md
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
      color: TavariStyles.colors.gray700,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    inputWrapper: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center'
    },
    input: {
      width: '100%',
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      paddingRight: '48px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      backgroundColor: TavariStyles.colors.white,
      transition: 'border-color 0.2s',
      boxSizing: 'border-box'
    },
    toggleButton: {
      position: 'absolute',
      right: TavariStyles.spacing.md,
      background: 'none',
      border: 'none',
      color: TavariStyles.colors.gray500,
      cursor: 'pointer',
      padding: TavariStyles.spacing.xs,
      display: 'flex',
      alignItems: 'center'
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
      opacity: submitting ? 0.7 : 1,
      transition: 'opacity 0.2s',
      marginTop: TavariStyles.spacing.md
    },
    infoBox: {
      backgroundColor: TavariStyles.colors.primary + '10',
      border: `1px solid ${TavariStyles.colors.primary}30`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.lg
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', padding: TavariStyles.spacing.xl }}>
            <p>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>Complete Your Account Setup</h1>
          <p style={styles.subtitle}>Please create a password and PIN to access your employee portal</p>
        </div>

        <div style={styles.infoBox}>
          <strong>Password:</strong> At least 6 characters (used for portal login)<br />
          <strong>PIN:</strong> At least 4 digits (used for time clock and other secure operations)
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {error && (
            <div style={styles.errorMsg}>{error}</div>
          )}

          <div style={styles.inputGroup}>
            <label htmlFor="password" style={styles.label}>
              <Lock size={16} />
              Password
            </label>
            <div style={styles.inputWrapper}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                placeholder="Enter password (min 6 characters)"
                required
                disabled={submitting}
                style={styles.input}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={styles.toggleButton}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div style={styles.inputGroup}>
            <label htmlFor="confirmPassword" style={styles.label}>
              <Lock size={16} />
              Confirm Password
            </label>
            <div style={styles.inputWrapper}>
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={formData.confirmPassword}
                onChange={(e) => setFormData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                placeholder="Confirm your password"
                required
                disabled={submitting}
                style={styles.input}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                style={styles.toggleButton}
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div style={styles.inputGroup}>
            <label htmlFor="pin" style={styles.label}>
              <Key size={16} />
              PIN
            </label>
            <div style={styles.inputWrapper}>
              <input
                id="pin"
                type={showPin ? 'text' : 'password'}
                value={formData.pin}
                onChange={(e) => setFormData(prev => ({ ...prev, pin: e.target.value.replace(/\D/g, '') }))}
                placeholder="Enter PIN (4+ digits)"
                required
                disabled={submitting}
                style={styles.input}
                maxLength={10}
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                style={styles.toggleButton}
                tabIndex={-1}
              >
                {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={styles.button}
          >
            {submitting ? 'Setting up...' : 'Complete Setup'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PortalPasswordSetup;

