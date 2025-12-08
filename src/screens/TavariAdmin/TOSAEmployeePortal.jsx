// screens/TavariAdmin/TOSAEmployeePortal.jsx - WITH PERMISSION SYSTEM + NO CONSOLE LOGGING
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiEye, FiEyeOff, FiShield, FiLock, FiUser } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

// Security & Authentication
import { SecurityWrapper, useSecurityContext } from '../../Security';

// Foundation Components
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../../components/UI/TavariCheckbox';

/**
 * TOSAEmployeePortal - Hidden login portal for Tavari OS Admin employees
 * Accessible only via direct URL: tavarios.ca/employeeportal
 * Includes comprehensive security monitoring and audit logging
 */
const TOSAEmployeePortal = () => {
  const navigate = useNavigate();
  
  // Security context for monitoring and protection at CRITICAL level
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent,
    securityState
  } = useSecurityContext({
    componentName: 'TOSAEmployeePortal',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableDeviceTracking: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  // Form state
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false
  });

  // UI state
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [lockoutTime, setLockoutTime] = useState(null);

  // TOSA is now open - redirect directly to dashboard
  useEffect(() => {
    navigate('/tosa/dashboard');
  }, [navigate]);

  // Handle lockout timer
  useEffect(() => {
    if (isLocked && lockoutTime) {
      const timer = setInterval(() => {
        const timeRemaining = lockoutTime - Date.now();
        if (timeRemaining <= 0) {
          setIsLocked(false);
          setLockoutTime(null);
          setLoginAttempts(0);
          clearInterval(timer);
        }
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [isLocked, lockoutTime]);

  /**
   * Check if user is already authenticated
   */
  const checkExistingAuth = async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (session?.user) {
        // Verify this is a Tavari employee
        const { data: employeeData, error: empError } = await supabase
          .from('tavari_employees')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('is_active', true)
          .single();

        if (!empError && employeeData) {
          await logSecurityEvent('tosa_existing_session_detected', {
            action: 'existing_session_found',
            employee_id: employeeData.id,
            employee_email: employeeData.email,
            session_id: session.access_token.substring(0, 10) + '...'
          }, 'high');
          
          navigate('/tosa/dashboard');
        }
      }
    } catch (error) {
      await logSecurityEvent('tosa_session_check_error', {
        action: 'session_check_failed',
        error_message: error.message
      }, 'high');
    }
  };

  /**
   * Handle form input changes with security validation
   */
  const handleInputChange = async (field, value) => {
    // Basic validation - don't block normal typing
    if (value.length > 500) {
      setError(`${field} is too long`);
      return;
    }

    // Update form data immediately for better UX
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear error on input change
    if (error) setError('');

    // Security validation in background
    if (value.length > 0) {
      const validation = await validateInput(
        value, 
        field === 'email' ? 'email' : 'text',
        field
      );

      if (!validation.valid) {
        // Log validation warning but don't block input
        await logSecurityEvent('tosa_input_validation_warning', {
          action: 'input_validation_failed',
          field: field,
          reason: validation.message
        }, 'low');
      }
    }
  };

  /**
   * Handle login form submission
   */
  const handleLogin = async (e) => {
    e.preventDefault();
    
    if (isLocked) {
      const timeRemaining = Math.ceil((lockoutTime - Date.now()) / 1000);
      setError(`Account locked. Try again in ${timeRemaining} seconds.`);
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('tosa_login_attempt');
      if (!rateLimitCheck.allowed) {
        await logSecurityEvent('tosa_rate_limit_exceeded', {
          action: 'rate_limit_blocked_login',
          email: formData.email,
          ip_address: securityState?.userIP
        }, 'critical');
        
        throw new Error('Too many login attempts. Please wait a moment.');
      }

      // Record login attempt
      await recordAction('tosa_login_attempt', formData.email, false);
      await logSecurityEvent('tosa_login_attempt_initiated', {
        action: 'login_attempt_started',
        email: formData.email,
        ip_address: securityState?.userIP,
        device_fingerprint: securityState?.deviceFingerprint,
        timestamp: new Date().toISOString()
      }, 'high');
      
      // Validate form data
      if (!formData.email || !formData.password) {
        throw new Error('Email and password are required');
      }

      // Validate email format
      const emailValidation = await validateInput(formData.email, 'email', 'email');
      if (!emailValidation.valid) {
        throw new Error('Invalid email format');
      }

      // Attempt authentication
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password
      });

      if (authError) {
        throw authError;
      }

      // Verify user is a Tavari employee
      const { data: employeeData, error: empError } = await supabase
        .from('tavari_employees')
        .select(`
          *,
          tavari_employee_roles (
            role_name,
            permissions
          )
        `)
        .eq('user_id', authData.user.id)
        .eq('is_active', true)
        .single();

      if (empError || !employeeData) {
        // This is a CRITICAL security event - someone tried to access TOSA without employee credentials
        await logSecurityEvent('tosa_unauthorized_access_attempt', {
          action: 'unauthorized_tosa_access',
          email: formData.email,
          user_id: authData.user?.id,
          ip_address: securityState?.userIP,
          device_fingerprint: securityState?.deviceFingerprint,
          timestamp: new Date().toISOString()
        }, 'critical');

        await recordAction('tosa_unauthorized_access', formData.email, false);

        // Sign out the user immediately
        await supabase.auth.signOut();
        throw new Error('Access denied. This portal is restricted to authorized personnel only.');
      }

      // Successful login - log security event
      await logSecurityEvent('tosa_login_success', {
        action: 'login_successful',
        employee_id: employeeData.id,
        employee_name: employeeData.full_name,
        employee_email: employeeData.email,
        role: employeeData.tavari_employee_roles?.role_name,
        last_login: employeeData.last_login,
        ip_address: securityState?.userIP,
        device_fingerprint: securityState?.deviceFingerprint,
        timestamp: new Date().toISOString()
      }, 'critical');

      // Update employee last login
      await supabase
        .from('tavari_employees')
        .update({ 
          last_login: new Date().toISOString(),
          login_count: (employeeData.login_count || 0) + 1
        })
        .eq('id', employeeData.id);

      // Store employee data in localStorage for quick access
      localStorage.setItem('tosa_employee', JSON.stringify({
        id: employeeData.id,
        email: employeeData.email,
        full_name: employeeData.full_name,
        role: employeeData.tavari_employee_roles?.role_name,
        permissions: employeeData.tavari_employee_roles?.permissions
      }));

      // Record successful action
      await recordAction('tosa_login_attempt', formData.email, true);
      
      toast.success(`Welcome, ${employeeData.full_name}`);
      
      // Navigate to dashboard
      navigate('/tosa/dashboard');

    } catch (error) {
      // Increment login attempts
      const newAttempts = loginAttempts + 1;
      setLoginAttempts(newAttempts);
      
      // Lock account after 3 failed attempts
      if (newAttempts >= 3) {
        const lockUntil = Date.now() + (5 * 60 * 1000); // 5 minutes
        setIsLocked(true);
        setLockoutTime(lockUntil);
        
        await logSecurityEvent('tosa_account_locked', {
          action: 'account_locked_failed_attempts',
          email: formData.email,
          attempts: newAttempts,
          locked_until: new Date(lockUntil).toISOString(),
          ip_address: securityState?.userIP,
          device_fingerprint: securityState?.deviceFingerprint
        }, 'critical');
        
        await recordAction('tosa_account_locked', formData.email, false);
        
        setError('Too many failed attempts. Account locked for 5 minutes.');
        toast.error('Account locked for 5 minutes due to multiple failed attempts');
      } else {
        const errorMessage = error.message || 'Login failed. Please check your credentials.';
        setError(errorMessage);
        
        await logSecurityEvent('tosa_login_failure', {
          action: 'login_failed',
          email: formData.email,
          error_message: error.message,
          attempts: newAttempts,
          ip_address: securityState?.userIP,
          device_fingerprint: securityState?.deviceFingerprint,
          timestamp: new Date().toISOString()
        }, 'high');
        
        await recordAction('tosa_login_failure', formData.email, false);
        
        toast.error(`Login failed (Attempt ${newAttempts}/3)`);
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Get lockout time remaining in seconds
   */
  const getLockoutTimeRemaining = () => {
    if (!isLocked || !lockoutTime) return 0;
    return Math.max(0, Math.ceil((lockoutTime - Date.now()) / 1000));
  };

  const styles = {
    container: {
      minHeight: '100vh',
      background: `linear-gradient(135deg, ${TavariStyles.colors.primaryDark} 0%, ${TavariStyles.colors.primary} 100%)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: TavariStyles.spacing.xl,
      fontFamily: TavariStyles.typography.fontFamily
    },

    loginCard: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.xl,
      padding: TavariStyles.spacing['3xl'],
      boxShadow: TavariStyles.shadows.modal,
      width: '100%',
      maxWidth: '450px',
      position: 'relative'
    },

    header: {
      textAlign: 'center',
      marginBottom: TavariStyles.spacing['3xl']
    },

    logo: {
      fontSize: '48px',
      color: TavariStyles.colors.primary,
      marginBottom: TavariStyles.spacing.lg
    },

    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm
    },

    subtitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },

    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xl
    },

    inputGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },

    label: {
      ...TavariStyles.components.form.label,
      color: TavariStyles.colors.gray700
    },

    inputWrapper: {
      position: 'relative',
      width: '100%'
    },

    input: {
      ...TavariStyles.components.form.input,
      width: '100%',
      paddingRight: '50px',
      fontSize: TavariStyles.typography.fontSize.lg,
      border: `2px solid ${TavariStyles.colors.gray200}`,
      boxSizing: 'border-box'
    },

    inputFocused: {
      borderColor: TavariStyles.colors.primary,
      outline: 'none',
      boxShadow: `0 0 0 3px ${TavariStyles.colors.primary}20`
    },

    eyeButton: {
      position: 'absolute',
      right: TavariStyles.spacing.md,
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: TavariStyles.colors.gray500,
      fontSize: TavariStyles.typography.fontSize.lg,
      padding: TavariStyles.spacing.xs
    },

    rememberMe: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },

    submitButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      padding: TavariStyles.spacing.lg,
      marginTop: TavariStyles.spacing.md,
      opacity: (loading || isLocked) ? 0.6 : 1,
      cursor: (loading || isLocked) ? 'not-allowed' : 'pointer'
    },

    error: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      textAlign: 'center',
      marginBottom: TavariStyles.spacing.xl
    },

    lockoutWarning: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.warning,
      textAlign: 'center',
      marginBottom: TavariStyles.spacing.xl
    },

    footer: {
      textAlign: 'center',
      marginTop: TavariStyles.spacing['3xl'],
      padding: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`
    },

    footerText: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray500,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },

    securityBadge: {
      position: 'absolute',
      top: TavariStyles.spacing.md,
      right: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.success,
      color: TavariStyles.colors.white,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.md,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    }
  };

  return (
    <SecurityWrapper
      componentName="TOSAEmployeePortal"
      sensitiveComponent={true}
      showSecurityStatus={false}
      securityLevel="critical"
    >
      <div style={styles.container}>
        <div style={styles.loginCard}>
          {/* Security Badge */}
          <div style={styles.securityBadge}>
            <FiShield size={12} />
            <span>SECURE</span>
          </div>

          {/* Header */}
          <div style={styles.header}>
            <div style={styles.logo}>
              <FiLock />
            </div>
            <h1 style={styles.title}>Tavari OS Admin</h1>
            <p style={styles.subtitle}>Employee Portal</p>
          </div>

          {/* Error Messages */}
          {error && (
            <div style={styles.error}>
              {error}
            </div>
          )}

          {/* Lockout Warning */}
          {isLocked && (
            <div style={styles.lockoutWarning}>
              Account locked for security. Time remaining: {getLockoutTimeRemaining()}s
            </div>
          )}

          {/* Login Form */}
          <form style={styles.form} onSubmit={handleLogin}>
            {/* Email Input */}
            <div style={styles.inputGroup}>
              <label style={styles.label}>Email Address</label>
              <div style={styles.inputWrapper}>
                <input
                  type="email"
                  style={styles.input}
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  onFocus={(e) => Object.assign(e.target.style, styles.inputFocused)}
                  onBlur={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.gray200;
                    e.target.style.boxShadow = 'none';
                  }}
                  placeholder="Enter your Tavari email"
                  disabled={loading || isLocked}
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            {/* Password Input */}
            <div style={styles.inputGroup}>
              <label style={styles.label}>Password</label>
              <div style={styles.inputWrapper}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  style={styles.input}
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  onFocus={(e) => Object.assign(e.target.style, styles.inputFocused)}
                  onBlur={(e) => {
                    e.target.style.borderColor = TavariStyles.colors.gray200;
                    e.target.style.boxShadow = 'none';
                  }}
                  placeholder="Enter your password"
                  disabled={loading || isLocked}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  style={styles.eyeButton}
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading || isLocked}
                  tabIndex={-1}
                >
                  {showPassword ? <FiEyeOff /> : <FiEye />}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div style={styles.rememberMe}>
              <TavariCheckbox
                checked={formData.rememberMe}
                onChange={(checked) => setFormData(prev => ({ ...prev, rememberMe: checked }))}
                label="Keep me signed in"
                disabled={loading || isLocked}
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              style={styles.submitButton}
              disabled={loading || isLocked}
            >
              {loading ? 'Authenticating...' : 'Access Portal'}
            </button>
          </form>

          {/* Footer */}
          <div style={styles.footer}>
            <p style={styles.footerText}>
              This portal is restricted to authorized Tavari employees only.<br />
              All access attempts are monitored and logged for security purposes.<br />
              <strong>Unauthorized access is prohibited.</strong>
            </p>
          </div>
        </div>
      </div>
    </SecurityWrapper>
  );
};

export default TOSAEmployeePortal;