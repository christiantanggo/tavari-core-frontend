// Login.jsx - Enhanced with centralized auth cleanup
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { TavariStyles } from '../utils/TavariStyles';
import TavariCheckbox from '../components/UI/TavariCheckbox';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import { 
  SecurityWrapper, 
  useSecurityContext, 
  SECURITY_PRESETS,
  validateFormSecurity 
} from '../Security';
import { sessionPersistence } from '../services/SessionPersistence';
import { setBusinessId } from '../utils/authCleanup';
import { getPublicUserId } from '../utils/getPublicUserId';
import { membershipUserIdOrFilter } from '../utils/employeePortalMembership';
import {
  clearPermissionsSessionCache,
  clearPosAuthSessionCache,
} from '../utils/posAuthSessionCache';

const LoginComponent = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [stayLoggedIn, setStayLoggedIn] = useState(() => {
    const storedPreference = localStorage.getItem('stayLoggedInPreference');
    if (storedPreference === null) {
      // Default to true so sessions persist unless explicitly disabled
      return true;
    }
    return storedPreference === 'true';
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const navigate = useNavigate();
  const passwordInputRef = useRef(null);
  const emailInputRef = useRef(null);

  // If the day session is still active, send staff to PIN unlock — not email/password again.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionPersistence.isPersistenceEnabled()) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.user) {
        navigate('/unlock', { replace: true });
        return;
      }
      const restoreResult = await sessionPersistence.restoreSession();
      if (!cancelled && restoreResult.restored) {
        navigate('/unlock', { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // Initialize security context with admin-level security for login
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent,
    clearValidationErrors,
    securityState
  } = useSecurityContext({
    componentName: 'LoginForm',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableDeviceTracking: true,
    enableInputValidation: true,
    enableAuditLogging: true,
    sessionTimeout: 10 * 60 * 1000, // 10 minutes for login page
    onSessionTimeout: () => {
      setErrorMsg('Login session timed out for security. Please refresh the page.');
    }
  });

  // Do not wipe an active shift session just because the login screen was opened briefly
  // (e.g. a transient auth hiccup on POS). Full cleanup happens on explicit logout or new login.

  const handleLogin = async () => {
    // Prevent multiple simultaneous login attempts
    if (isLoading) return;
    
    setErrorMsg('');
    setIsLoading(true);
    clearValidationErrors();

    try {
      // Validate inputs using security context
      const emailValidation = await validateInput(email, 'email', 'email');
      const passwordValidation = await validateInput(password, 'password', 'password');

      if (!emailValidation.valid) {
        setErrorMsg(emailValidation.error);
        setIsLoading(false);
        return;
      }

      if (!passwordValidation.valid) {
        setErrorMsg(passwordValidation.error);
        setIsLoading(false);
        return;
      }

      // Use sanitized inputs
      const sanitizedEmail = emailValidation.sanitized;
      const sanitizedPassword = passwordValidation.sanitized;

      // Check rate limiting before attempting login
      const rateLimitCheck = await checkRateLimit('login', sanitizedEmail);
      if (!rateLimitCheck.allowed) {
        setErrorMsg(rateLimitCheck.message);
        setIsLoading(false);
        return;
      }

      // Log login attempt with enhanced security context
      await logSecurityEvent('login_attempt', {
        login_method: 'email_password',
        stay_logged_in: stayLoggedIn,
        data_type: 'authentication',
        data_action: 'login_attempt'
      }, 'medium');

      // Check if user is locked out by database lookup
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      let lockedUserId = null;
      const { data: userLookup } = await supabase
        .from('users')
        .select('id')
        .eq('email', sanitizedEmail)
        .maybeSingle();

      if (userLookup?.id) {
        lockedUserId = userLookup.id;

        // Check recent failed attempts in audit logs
        const { data: recentFails } = await supabase
          .from('audit_logs')
          .select('id')
          .eq('event_type', 'failed_login')
          .eq('user_id', lockedUserId)
          .gte('created_at', since);

        if (recentFails && recentFails.length >= 3) {
          await logSecurityEvent('account_lockout', {
            user_id: lockedUserId,
            failed_attempt_count: recentFails.length,
            lockout_reason: 'Too many recent failed attempts',
            threat_type: 'brute_force_attempt',
            threat_details: {
              attempts_in_window: recentFails.length,
              window_minutes: 10
            }
          }, 'high');
          
          await recordAction('login', false, sanitizedEmail);
          setErrorMsg('Account is temporarily locked. Please try again in 10 minutes.');
          setIsLoading(false);
          return;
        }

        // Log suspicious activity for new devices
        const { data: recentLogins } = await supabase
          .from('audit_logs')
          .select('details')
          .eq('event_type', 'login')
          .eq('user_id', lockedUserId)
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(5);

        if (recentLogins && recentLogins.length > 0) {
          const knownDevices = recentLogins.some(login => 
            login.details?.device_fingerprint === securityState.deviceFingerprint
          );
          
          if (!knownDevices) {
            await logSecurityEvent('unusual_device_login', {
              user_id: lockedUserId,
              threat_type: 'device_anomaly',
              threat_details: {
                new_device: true,
                known_device_count: recentLogins.length,
                days_since_last_login: 0
              }
            }, 'medium');
          }
        }
      }

      // Attempt Supabase authentication
      const { data, error } = await supabase.auth.signInWithPassword({
        email: sanitizedEmail,
        password: sanitizedPassword,
      });

      if (error) {
        // Record failed login attempt
        await recordAction('login', false, sanitizedEmail);

        // Log failed login with enhanced security context
        await logSecurityEvent('failed_login', {
          login_method: 'email_password',
          login_success: false,
          failed_attempt_count: 1,
          lockout_reason: error.message,
          error_message: error.message,
          data_type: 'authentication',
          data_action: 'login_failed',
          threat_type: 'authentication_failure'
        }, 'medium');

        // Insert into audit_logs table for database tracking
        await supabase.from("audit_logs").insert({
          user_id: userLookup?.id || null,
          event_type: "failed_login",
          details: {
            email_attempted: sanitizedEmail,
            reason: error.message,
            timestamp: new Date().toISOString(),
            device_fingerprint: securityState.deviceFingerprint,
            user_ip: securityState.userIP
          },
        });

        // Generic error message to prevent user enumeration
        setErrorMsg('Invalid credentials. Please check your email and password.');
        setIsLoading(false);
        return;
      }

      // Login successful - record success
      await recordAction('login', true, sanitizedEmail);

      // Log successful login with enhanced security details
      const user = data?.user;
      if (user?.id) {
        await logSecurityEvent('login_success', {
          user_id: user.id,
          login_method: 'email_password',
          login_success: true,
          stay_logged_in: stayLoggedIn,
          data_type: 'authentication',
          data_action: 'login_successful'
        }, 'low');

        // Insert successful login into audit_logs
        await supabase.from("audit_logs").insert({
          user_id: user.id,
          event_type: "login",
          details: {
            method: "email_password",
            stay_logged_in: stayLoggedIn,
            device_fingerprint: securityState.deviceFingerprint,
            user_ip: securityState.userIP
          },
        });
      }

      // Handle session persistence - enable 24-hour persistence
      if (stayLoggedIn) {
        const persistenceEnabled = await sessionPersistence.enablePersistence();
        
        // Ensure flag is set even if enablePersistence failed silently
        localStorage.setItem('stayLoggedIn', 'true');
        
        // Set session start time for 24-hour tracking
        localStorage.setItem('sessionStartTime', Date.now().toString());
        
        // For Electron desktop app: Save session to file for auto-login on restart
        if (window.electronAPI && data.session) {
          try {
            await window.electronAPI.saveSession({
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
              expires_at: data.session.expires_at,
              user: data.session.user
            });
            console.log('✅ Session saved for desktop app auto-login');
          } catch (err) {
            console.warn('⚠️ Failed to save session for desktop app:', err);
          }
        }
        
        await logSecurityEvent('session_persistence_enabled_24h', {
          user_id: user?.id,
          data_type: 'session_management',
          data_action: '24_hour_persistence_enabled',
          session_duration_hours: 24
        }, 'low');
      } else {
        sessionPersistence.disablePersistence();
        localStorage.removeItem('expiresAt');
        localStorage.removeItem('stayLoggedIn');
        localStorage.removeItem('sessionStartTime');
      }

      // Get user authentication data
      const {
        data: authData,
        error: getUserError,
      } = await supabase.auth.getUser();

      if (getUserError || !authData?.user?.id) {
        await logSecurityEvent('system_error', {
          error_message: getUserError?.message || 'Unable to retrieve user after login',
          data_type: 'authentication',
          data_action: 'post_login_verification',
          threat_type: 'authentication_system_error'
        }, 'high');
        
        setErrorMsg('Unable to retrieve user after login.');
        setIsLoading(false);
        return;
      }

      const userId = authData.user.id;
      const publicUserId = await getPublicUserId(authData.user.email);
      const membershipFilter = membershipUserIdOrFilter(userId, publicUserId);

      // Get user roles - with fresh data, no cache
      // Match auth.users.id OR public.users.id (split identity); see PortalLogin / RLS email-match policies
      const { data: roleRows, error: roleError } = await supabase
        .from("user_roles")
        .select("id, user_id, business_id, role, active, businesses(id, name)")
        .or(membershipFilter)
        .eq("active", true);

      if (roleError) {
        console.error('Error fetching user roles:', roleError);
        await logSecurityEvent('system_error', {
          user_id: userId,
          error_message: roleError.message,
          data_type: 'role_verification',
          data_action: 'role_fetch_failed'
        }, 'high');
        
        setErrorMsg('Login succeeded, but unable to load user roles.');
        setIsLoading(false);
        return;
      }

      const dedupeByBusiness = (rows, normalizeUserId) => {
        const map = new Map();
        for (const row of rows || []) {
          if (!row?.business_id) continue;
          if (!map.has(row.business_id)) {
            map.set(row.business_id, normalizeUserId ? { ...row, user_id: userId } : { ...row });
          }
        }
        return Array.from(map.values());
      };

      let roleList = dedupeByBusiness(roleRows, true);

      // Fallback: business_users only (e.g. manual DB change or failed user_roles sync)
      if (!roleList.length) {
        const { data: buRows, error: buError } = await supabase
          .from('business_users')
          .select('id, user_id, business_id, role, businesses(id, name)')
          .or(membershipFilter);

        if (buError) {
          console.warn('Login: business_users fallback failed:', buError);
        } else if (buRows?.length) {
          roleList = dedupeByBusiness(
            buRows.map((bu) => ({
              id: bu.id,
              user_id: userId,
              business_id: bu.business_id,
              role: bu.role,
              active: true,
              businesses: bu.businesses
            })),
            false
          );
        }
      }

      if (!roleList || roleList.length === 0) {
        await logSecurityEvent('unauthorized_access', {
          user_id: userId,
          data_type: 'role_verification',
          data_action: 'no_active_roles',
          threat_type: 'unauthorized_access',
          threat_details: {
            roles_found: 0
          }
        }, 'high');
        
        setErrorMsg('Login succeeded, but no active business roles found.');
        setIsLoading(false);
        return;
      }

      // Store business data - fresh from database
      localStorage.setItem('businessList', JSON.stringify(roleList));
      const currentBusiness = roleList[0];
      
      // Set business IDs for the shift (pinned across PIN locks)
      setBusinessId(currentBusiness.business_id);
      localStorage.setItem('lastAuthUserId', userId);

      try {
        const { data: userProfileData } = await supabase
          .from('users')
          .select('full_name, first_name, last_name, email')
          .eq('id', userId)
          .maybeSingle();

        const displayName = userProfileData?.full_name
          || [userProfileData?.first_name, userProfileData?.last_name].filter(Boolean).join(' ')
          || authData.user.email;

        const initialActivePosUser = {
          id: userId,
          role: currentBusiness.role || 'employee',
          full_name: userProfileData?.full_name || null,
          first_name: userProfileData?.first_name || null,
          last_name: userProfileData?.last_name || null,
          email: userProfileData?.email || authData.user.email,
          name: displayName,
          business_id: currentBusiness.business_id,
          unlocked_at: Date.now(),
          source: 'login'
        };

        localStorage.setItem('posActiveUser', JSON.stringify(initialActivePosUser));
        localStorage.setItem('posLoginUser', JSON.stringify(initialActivePosUser));
        localStorage.setItem('posLastUnlockedBy', JSON.stringify(initialActivePosUser));
        clearPermissionsSessionCache(currentBusiness.business_id);
        clearPosAuthSessionCache(currentBusiness.business_id);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('pos-active-user-changed'));
        }
      } catch (posUserError) {
        console.warn('Unable to cache initial POS user after login:', posUserError?.message || posUserError);
      }

      // Generate new session ID for authenticated session
      const sessionId = btoa(Date.now() + Math.random() + userId);
      sessionStorage.setItem('sessionId', sessionId);

      await logSecurityEvent('session_start', {
        user_id: userId,
        data_type: 'session_management',
        data_action: 'authenticated_session_created',
        details: {
          business_id: currentBusiness.business_id,
          role: currentBusiness.role,
          session_id: sessionId
        }
      }, 'low');

      // Navigate based on role - Employees go directly to POS
      if (['owner', 'admin', 'manager', 'employee'].includes(currentBusiness.role)) {
        // Route employees directly to POS Register
        if (currentBusiness.role === 'employee') {
          await logSecurityEvent('employee_pos_redirect', {
            user_id: userId,
            data_type: 'navigation',
            data_action: 'employee_auto_redirect_to_pos',
            details: {
              business_id: currentBusiness.business_id,
              role: currentBusiness.role
            }
          }, 'low');
          
          navigate('/dashboard/pos/register');
          toast.success('Welcome! Redirecting to POS...');
        } else {
          // Owners, admins, and managers go to main dashboard
          await logSecurityEvent('management_dashboard_redirect', {
            user_id: userId,
            data_type: 'navigation',
            data_action: 'management_dashboard_access',
            details: {
              business_id: currentBusiness.business_id,
              role: currentBusiness.role
            }
          }, 'low');
          
          navigate('/dashboard/home');
          toast.success(`Welcome back, ${currentBusiness.role}!`);
        }
      } else {
        await logSecurityEvent('unauthorized_access', {
          user_id: userId,
          data_type: 'role_verification',
          data_action: 'invalid_role_access_attempt',
          threat_type: 'privilege_escalation',
          threat_details: {
            attempted_role: currentBusiness.role,
            valid_roles: ['owner', 'admin', 'manager', 'employee']
          }
        }, 'high');
        navigate('/locked');
      }

    } catch (error) {
      await logSecurityEvent('system_error', {
        error_message: error.message,
        error_stack: error.stack,
        data_type: 'authentication',
        data_action: 'login_system_error',
        system_context: {
          email_attempted: email,
          component: 'login_form'
        }
      }, 'high');
      
      await recordAction('login', false, email);
      setErrorMsg('An unexpected error occurred. Please try again.');
      toast.error('Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle paste prevention for password field
  const handlePasswordPaste = (e) => {
    e.preventDefault();
    setErrorMsg('Pasting passwords is not allowed for security reasons.');
    
    logSecurityEvent('suspicious_activity', {
      threat_type: 'password_paste_attempt',
      data_type: 'input_validation',
      data_action: 'paste_blocked',
      threat_details: {
        field: 'password',
        component: 'login_form'
      }
    }, 'low');
    
    setTimeout(() => setErrorMsg(''), 3000);
  };

  const styles = {
    container: {
      ...TavariStyles.layout.flexCenter,
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.xl,
      fontFamily: TavariStyles.typography.fontFamily
    },
    
    loginCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing['4xl'],
      maxWidth: '400px',
      width: '100%',
      textAlign: 'center',
      position: 'relative'
    },
    
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing['2xl'],
      margin: '0 0 32px 0'
    },
    
    dateDisplay: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xl,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    
    inputGroup: {
      marginBottom: TavariStyles.spacing.lg,
      textAlign: 'left',
      position: 'relative'
    },
    
    label: {
      ...TavariStyles.components.form.label,
      textAlign: 'left'
    },
    
    input: {
      ...TavariStyles.components.form.input,
      width: '100%',
      boxSizing: 'border-box',
      transition: TavariStyles.transitions.normal
    },
    
    inputFocus: {
      borderColor: TavariStyles.colors.primary,
      outline: 'none',
      boxShadow: `0 0 0 2px ${TavariStyles.colors.primary}20`
    },
    
    inputError: {
      borderColor: TavariStyles.colors.danger,
      boxShadow: `0 0 0 2px ${TavariStyles.colors.danger}20`
    },
    
    passwordContainer: {
      position: 'relative',
      width: '100%'
    },
    
    passwordToggle: {
      position: 'absolute',
      right: '12px',
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: TavariStyles.colors.gray500,
      fontSize: TavariStyles.typography.fontSize.sm,
      zIndex: 1
    },
    
    validationError: {
      color: TavariStyles.colors.danger,
      fontSize: TavariStyles.typography.fontSize.xs,
      marginTop: TavariStyles.spacing.xs,
      textAlign: 'left'
    },
    
    checkboxContainer: {
      marginBottom: TavariStyles.spacing.xl,
      textAlign: 'left'
    },
    
    loginButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      width: '100%',
      marginBottom: TavariStyles.spacing.lg,
      opacity: isLoading ? 0.6 : 1,
      cursor: isLoading ? 'not-allowed' : 'pointer'
    },
    
    loginButtonHover: {
      backgroundColor: TavariStyles.colors.primaryDark,
      transform: 'translateY(-1px)',
      boxShadow: TavariStyles.shadows.md
    },
    
    forgotPassword: {
      color: TavariStyles.colors.primary,
      cursor: 'pointer',
      marginTop: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.sm,
      textAlign: 'center',
      textDecoration: 'underline',
      transition: TavariStyles.transitions.normal
    },
    
    forgotPasswordHover: {
      color: TavariStyles.colors.primaryDark
    },
    
    registerText: {
      marginTop: TavariStyles.spacing.xl,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    
    registerLink: {
      color: TavariStyles.colors.primary,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      textDecoration: 'underline',
      transition: TavariStyles.transitions.normal
    },
    
    registerLinkHover: {
      color: TavariStyles.colors.primaryDark
    },
    
    errorMessage: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.lg,
      textAlign: 'center',
      fontSize: TavariStyles.typography.fontSize.sm
    },
    
    loadingSpinner: {
      display: 'inline-block',
      width: '16px',
      height: '16px',
      border: '2px solid #ffffff40',
      borderTop: '2px solid #ffffff',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      marginRight: '8px'
    },
    
    securityIndicator: {
      position: 'absolute',
      top: TavariStyles.spacing.sm,
      right: TavariStyles.spacing.sm,
      width: '12px',
      height: '12px',
      borderRadius: '50%',
      backgroundColor: securityState.isSecure ? TavariStyles.colors.success : TavariStyles.colors.warning
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.loginCard}>
        {/* Security indicator */}
        <div style={styles.securityIndicator} title={securityState.isSecure ? 'Secure Connection' : 'Security Warning'} />
        
        <h2 style={styles.title}>Welcome Back</h2>
        
        <div style={styles.inputGroup}>
          <label style={styles.label}>Email Address</label>
          <input
            ref={emailInputRef}
            style={{
              ...styles.input,
              ...(securityState.validationErrors?.email ? styles.inputError : {})
            }}
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={(e) => Object.assign(e.target.style, styles.inputFocus)}
            onBlur={(e) => Object.assign(e.target.style, styles.input)}
            disabled={isLoading}
            maxLength={254}
            autoComplete="off"
            spellCheck={false}
          />
          {securityState.validationErrors?.email && (
            <div style={styles.validationError}>
              {securityState.validationErrors.email}
            </div>
          )}
        </div>

        <div style={styles.inputGroup}>
          <label style={styles.label}>Password</label>
          <div style={styles.passwordContainer}>
            <input
              ref={passwordInputRef}
              style={{
                ...styles.input, 
                paddingRight: '40px',
                ...(securityState.validationErrors?.password ? styles.inputError : {})
              }}
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={(e) => Object.assign(e.target.style, styles.inputFocus)}
              onBlur={(e) => Object.assign(e.target.style, {...styles.input, paddingRight: '40px'})}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !isLoading) {
                  handleLogin();
                }
              }}
              onPaste={handlePasswordPaste}
              disabled={isLoading}
              maxLength={128}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              style={styles.passwordToggle}
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              disabled={isLoading}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {securityState.validationErrors?.password && (
            <div style={styles.validationError}>
              {securityState.validationErrors.password}
            </div>
          )}
        </div>

        {errorMsg && (
          <div style={styles.errorMessage}>
            {errorMsg}
          </div>
        )}

        <div style={styles.checkboxContainer}>
          <TavariCheckbox
            checked={stayLoggedIn}
            onChange={(checked) => {
              setStayLoggedIn(checked);
              localStorage.setItem('stayLoggedInPreference', checked ? 'true' : 'false');
              if (checked) {
                localStorage.setItem('stayLoggedIn', 'true');
              } else {
                localStorage.removeItem('stayLoggedIn');
              }
            }}
            label="Stay logged in (requires PIN after 5 minutes of inactivity)"
            size="md"
            id="stayLoggedIn"
            disabled={isLoading}
          />
        </div>

        <button 
          style={styles.loginButton} 
          onClick={handleLogin}
          onMouseEnter={(e) => !isLoading && Object.assign(e.target.style, styles.loginButtonHover)}
          onMouseLeave={(e) => Object.assign(e.target.style, styles.loginButton)}
          disabled={isLoading}
        >
          {isLoading && <span style={styles.loadingSpinner}></span>}
          {isLoading ? 'Signing In...' : 'Sign In'}
        </button>

        <p
          style={styles.forgotPassword}
          onClick={() => !isLoading && navigate("/forgot-password")}
          onMouseEnter={(e) => !isLoading && Object.assign(e.target.style, styles.forgotPasswordHover)}
          onMouseLeave={(e) => Object.assign(e.target.style, styles.forgotPassword)}
        >
          Forgot your password?
        </p>

        <p style={styles.registerText}>
          Don't have an account?{' '}
          <span 
            style={styles.registerLink} 
            onClick={() => !isLoading && navigate('/register')}
            onMouseEnter={(e) => !isLoading && Object.assign(e.target.style, styles.registerLinkHover)}
            onMouseLeave={(e) => Object.assign(e.target.style, styles.registerLink)}
          >
            Create Account
          </span>
        </p>
      </div>
      
      {/* Add CSS for spinner animation */}
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};

// Wrap the login component with security
const Login = () => {
  return (
    <SecurityWrapper
      componentName="LoginPage"
      enableRateLimiting={true}
      enableDeviceTracking={true}
      enableInputValidation={true}
      enableAuditLogging={true}
      sensitiveComponent={true}
      requireSecureConnection={true}
      sessionTimeout={10 * 60 * 1000} // 10 minutes
      securityLevel="high"
      autoBlock={false}
      showSecurityStatus={false}
      onSecurityThreat={(threat) => {
        // Security threats are logged automatically via security context
      }}
      onSessionTimeout={() => {
        // Session timeout handled by component state
      }}
      onRateLimitExceeded={(blockedActions) => {
        // Rate limit events logged automatically
      }}
    >
      <LoginComponent />
    </SecurityWrapper>
  );
};

export default Login;