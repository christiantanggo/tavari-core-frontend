// src/screens/Unlock.jsx - With centralized auth cleanup
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useUserProfile } from '../hooks/useUserProfile';
import { TavariStyles } from '../utils/TavariStyles';
import TavariCheckbox from '../components/UI/TavariCheckbox';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import { 
  SecurityWrapper, 
  useSecurityContext 
} from '../Security';
import bcrypt from 'bcryptjs';
import { sessionPersistence } from '../services/SessionPersistence';
import { clearAuthDataForExplicitLogout, resolveStoredBusinessId } from '../utils/authCleanup';
import { persistShiftBusinessId } from '../utils/shiftBusinessId';
import {
  getCustomerDisplayBusinessId,
  setCustomerDisplayPosLocked,
} from '../services/customerDisplayLocalState';
import { flushCustomerDisplayMirrorPush } from '../services/customerDisplayMirrorSync';
import {
  clearPermissionsSessionCache,
  clearPosAuthSessionCache,
} from '../utils/posAuthSessionCache';

const UnlockComponent = () => {
  const { profile } = useUserProfile();
  const navigate = useNavigate();
  const [pinInput, setPinInput] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [pinCooldownUntil, setPinCooldownUntil] = useState(null);
  const [shiftContextError, setShiftContextError] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [sessionInfo, setSessionInfo] = useState({
    timeLeft: '',
    autoLogoutAt: ''
  });
  
  const pinInputRef = useRef(null);
  const employeeCacheRef = useRef(null);
  const employeeCachePromiseRef = useRef(null);

  const getCurrentBusinessId = () => resolveStoredBusinessId();
  const getStoredPosLoginUser = () => {
    try {
      const raw = localStorage.getItem('posLoginUser');
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  };

  const pinsMatch = useCallback(async (inputPin, storedPin) => {
    if (!storedPin) return false;

    if (storedPin.startsWith('$2a$') || storedPin.startsWith('$2b$') || storedPin.startsWith('$2y$')) {
      try {
        return await bcrypt.compare(inputPin, storedPin);
      } catch (err) {
        console.warn('Failed to compare hashed PIN:', err?.message || err);
        return false;
      }
    }

    return String(storedPin) === String(inputPin);
  }, []);

  const loadEmployeeCache = useCallback(async () => {
    const businessId = getCurrentBusinessId();

    if (!businessId) {
      return [];
    }

    if (employeeCacheRef.current && employeeCacheRef.current.business_id === businessId) {
      return employeeCacheRef.current.employees;
    }

    if (employeeCachePromiseRef.current) {
      return employeeCachePromiseRef.current;
    }

    employeeCachePromiseRef.current = (async () => {
      try {
        // Use RPC function that bypasses RLS to get ALL employees for this business
        // This allows any employee to unlock regardless of who logged in
        const { data: staffMembers, error: staffError } = await supabase.rpc(
          'get_all_staff_pins_for_unlock',
          {
            p_business_id: businessId
          }
        );

        if (staffError) {
          console.error('Failed to load staff pins for unlock cache:', staffError.message);
          return [];
        }

        const employees = (staffMembers || []).map((staff) => ({
          ...staff,
          role: staff.role || 'employee',
          business_id: businessId
        }));

        employeeCacheRef.current = {
          business_id: businessId,
          employees
        };

        return employees;
      } catch (cacheError) {
        console.error('Failed to load employee cache:', cacheError);
        return [];
      } finally {
        employeeCachePromiseRef.current = null;
      }
    })();

    const result = await employeeCachePromiseRef.current;

    employeeCacheRef.current = {
      business_id: businessId,
      employees: result
    };

    return result;
  }, []);

  // Any staff PIN can unlock (same RPC as POS register — works without an active Supabase session).
  const findEmployeeByPin = useCallback(async (pin) => {
    const businessId = getCurrentBusinessId();
    if (!businessId) {
      console.error('❌ [Unlock] No business ID — cannot validate PIN');
      return { employee: null, reason: 'no_business' };
    }

    const employees = await loadEmployeeCache();
    if (!employees.length) {
      console.error('❌ [Unlock] No staff PINs loaded for business');
      return { employee: null, reason: 'no_staff_pins' };
    }

    for (const staff of employees) {
      if (!staff.pin) continue;
      if (await pinsMatch(pin, staff.pin)) {
        return {
          employee: {
            ...staff,
            role: staff.role || 'employee',
            business_id: businessId,
          },
          reason: null,
        };
      }
    }

    return { employee: null, reason: 'bad_pin' };
  }, [loadEmployeeCache, pinsMatch]);

  const getRoleForUser = useCallback(async (userId) => {
    if (!userId) return 'employee';
    const cache = await loadEmployeeCache();
    const cached = cache.find((employee) => employee.id === userId);
    return cached?.role || 'employee';
  }, [loadEmployeeCache]);

  const broadcastActivePosUserChange = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('pos-active-user-changed'));
    }
  };

  // Security context for sensitive unlock operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent,
    clearValidationErrors,
    securityState
  } = useSecurityContext({
    componentName: 'UnlockScreen',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableDeviceTracking: true,
    enableInputValidation: true,
    enableAuditLogging: true,
    sessionTimeout: 0, // NO timeout - unlock screen should stay open indefinitely
    onSessionTimeout: () => {
      // This should never be called since sessionTimeout is 0
      console.warn('Unlock screen session timeout triggered - this should not happen');
    }
  });

  // Fresh PIN attempts on each idle lock; recover shift business id instead of silent login redirect
  useEffect(() => {
    localStorage.removeItem('pinFailedAttempts');
    setFailedAttempts(0);

    const cooldownRaw = localStorage.getItem('pinUnlockCooldownUntil');
    if (cooldownRaw) {
      const until = parseInt(cooldownRaw, 10);
      if (until > Date.now()) {
        setPinCooldownUntil(until);
      } else {
        localStorage.removeItem('pinUnlockCooldownUntil');
      }
    }

    if (!sessionPersistence.isPersistenceEnabled()) {
      setShiftContextError('Your shift session has ended. Use Sign Out Completely, then log in with email and password.');
      return;
    }

    let businessId = resolveStoredBusinessId();
    if (!businessId) {
      const loginUser = getStoredPosLoginUser();
      if (loginUser?.business_id) {
        persistShiftBusinessId(loginUser.business_id);
        businessId = loginUser.business_id;
      }
    }

    if (!businessId) {
      setShiftContextError('Could not determine which business you are working in. Sign out and log in again, or contact a manager.');
    } else {
      setShiftContextError('');
    }
  }, []);

  // Focus PIN input on component mount
  useEffect(() => {
    const timer = setTimeout(() => {
      if (pinInputRef.current) {
        pinInputRef.current.focus();
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, []);

  // Ensure session continues to refresh even when on unlock screen
  useEffect(() => {
    if (sessionPersistence.isPersistenceEnabled()) {
      sessionPersistence.startAutoRefresh();
      void sessionPersistence.restoreSession();
    }
  }, []);

  // Load failed attempts from localStorage
  useEffect(() => {
    updateSessionInfo();
    const interval = setInterval(() => {
      updateSessionInfo();
      const cooldownRaw = localStorage.getItem('pinUnlockCooldownUntil');
      if (cooldownRaw) {
        const until = parseInt(cooldownRaw, 10);
        if (until > Date.now()) {
          setPinCooldownUntil(until);
        } else {
          localStorage.removeItem('pinUnlockCooldownUntil');
          setPinCooldownUntil(null);
        }
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);

  const updateSessionInfo = () => {
    const now = new Date();
    const autoLogoutTime = new Date();
    autoLogoutTime.setHours(3, 0, 0, 0);
    
    if (autoLogoutTime < now) {
      autoLogoutTime.setDate(autoLogoutTime.getDate() + 1);
    }
    
    const timeDiff = autoLogoutTime.getTime() - now.getTime();
    const hours = Math.floor(timeDiff / (1000 * 60 * 60));
    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    
    setSessionInfo({
      timeLeft: `${hours}h ${minutes}m`,
      autoLogoutAt: autoLogoutTime.toLocaleTimeString('en-US', { 
        hour12: true, 
        hour: 'numeric', 
        minute: '2-digit' 
      })
    });
  };

  const handleForceLogout = async (reason = 'Forced logout') => {
    try {
      await logSecurityEvent('forced_logout', {
        user_id: profile?.id,
        reason,
        data_type: 'session_management',
        data_action: 'forced_logout'
      }, 'medium');

      const today = new Date().toISOString().split('T')[0];
      localStorage.setItem('lastForcedLogout', today);
      
      // 🔧 CRITICAL: Use centralized cleanup function
      clearAuthDataForExplicitLogout('forced_logout');
      
      // Disable session persistence on forced logout
      sessionPersistence.disablePersistence();
      
      await supabase.auth.signOut();
      navigate('/login');
    } catch (err) {
      await logSecurityEvent('logout_error', {
        user_id: profile?.id,
        error_message: err.message,
        data_type: 'session_management',
        data_action: 'logout_failed'
      }, 'high');
      
      // Even on error, try to clean up
      clearAuthDataForExplicitLogout('logout_error');
      navigate('/login');
    }
  };

  const handleUnlock = async () => {
    if (isLoading) return;

    if (pinCooldownUntil && Date.now() < pinCooldownUntil) {
      const seconds = Math.ceil((pinCooldownUntil - Date.now()) / 1000);
      setError(`Too many wrong PINs. Wait ${seconds}s and try again.`);
      return;
    }

    if (shiftContextError && !resolveStoredBusinessId()) {
      setError(shiftContextError);
      return;
    }
    
    setError('');
    setIsLoading(true);
    clearValidationErrors();

    try {
      // Note: Daily 3am logout is handled by SessionPersistence.refreshToken() and App.jsx
      // We don't check it here during unlock because:
      // 1. If it's after 3am and the session expired, the user wouldn't be able to unlock anyway
      // 2. If the user logged in today (after 3am), they should be able to unlock with PIN
      // 3. The 3am check should only trigger on session refresh or app load, not during unlock

      // Validate PIN input
      const pinValidation = await validateInput(pinInput, 'pin', 'pin');
      if (!pinValidation.valid) {
        setError(pinValidation.error);
        setIsLoading(false);
        return;
      }

      if (!pinInput || pinInput.length !== 4) {
        setError('Please enter your 4-digit PIN');
        setIsLoading(false);
        return;
      }

      // Check rate limiting
      const rateLimitCheck = await checkRateLimit('unlock', profile?.id);
      if (!rateLimitCheck.allowed) {
        setError(rateLimitCheck.message);
        setIsLoading(false);
        return;
      }

      // Check PIN against ONLY the original logged-in user (full app unlock)
      // NOTE: For register-only unlock, see POSRegister.jsx which checks all employees
      console.log('🔓 [Unlock] handleUnlock called - validating PIN for full app unlock');
      console.log('🔓 [Unlock] PIN input length:', pinInput?.length);
      console.log('🔓 [Unlock] Profile available:', {
        hasProfile: !!profile,
        profileId: profile?.id,
        profileEmail: profile?.email
      });
      
      const pinResult = await findEmployeeByPin(pinInput);
      const unlockingUser = pinResult?.employee;
      const pinMatches = !!unlockingUser;

      console.log('🔓 [Unlock] PIN validation result:', {
        pinMatches,
        foundUser: !!unlockingUser,
        userId: unlockingUser?.id,
        userEmail: unlockingUser?.email
      });

      if (!pinMatches) {
        console.log('❌ [Unlock] PIN validation failed - will show error below');
        // Failed attempt, existing logic handles below
      }

      if (pinMatches && unlockingUser) {
        console.log('✅ [Unlock] PIN validated successfully - proceeding with full app unlock');
        const storedLoginUser = getStoredPosLoginUser();
        const isOriginalLoggedInUser = unlockingUser.id && profile?.id && unlockingUser.id === profile.id;
        const effectiveRole = (
          (isOriginalLoggedInUser && storedLoginUser?.id === unlockingUser.id && storedLoginUser?.role)
          || unlockingUser.role
          || profile?.role
          || await getRoleForUser(unlockingUser.id)
        );
        // Successful unlock
        await recordAction('unlock', true, unlockingUser?.id || profile?.id);
        
        // IMPORTANT: Restart auto-refresh if persistence enabled
        if (sessionPersistence.isPersistenceEnabled()) {
          console.log('🔄 Restarting auto-refresh after unlock...');
          sessionPersistence.startAutoRefresh();
        }
        
        await logSecurityEvent('successful_unlock', {
          user_id: unlockingUser?.id || profile?.id,
          data_type: 'authentication',
          data_action: 'pin_unlock_success',
          unlock_method: 'pin',
          persistent_session: sessionPersistence.isPersistenceEnabled()
        }, 'low');

        // Insert successful unlock audit log
        const businessId = getCurrentBusinessId();
        await supabase.from('audit_logs').insert({
          user_id: unlockingUser?.id || profile?.id,
          business_id: businessId || null,
          event_type: 'pin_login',
          details: {
            method: 'unlock_screen',
            time: new Date().toISOString(),
            device_fingerprint: securityState.deviceFingerprint,
            user_ip: securityState.userIP,
          },
        }).then(({ error: auditError }) => {
          if (auditError) {
            console.warn('Unlock audit log insert failed:', auditError.message);
          }
        });

        // Track which employee unlocked the register so POS can attribute sales
        if (unlockingUser?.id) {
          const displayName = unlockingUser.full_name || [unlockingUser.first_name, unlockingUser.last_name].filter(Boolean).join(' ') || unlockingUser.email || `Employee ${unlockingUser.id}`;
          const activeUserPayload = {
            id: unlockingUser.id,
            role: effectiveRole || 'employee',
            full_name: unlockingUser.full_name || displayName,
            first_name: unlockingUser.first_name || null,
            last_name: unlockingUser.last_name || null,
            email: unlockingUser.email || null,
            name: displayName,
            business_id: businessId || null,
            unlocked_at: Date.now(),
            source: 'unlock'
          };

          localStorage.setItem('posActiveUser', JSON.stringify(activeUserPayload));
          localStorage.setItem('posLastUnlockedBy', JSON.stringify(activeUserPayload));
          // Drop stale cashier permission/auth caches so dashboard remounts as the logged-in owner.
          clearPermissionsSessionCache(businessId || null);
          clearPosAuthSessionCache(businessId || null);
          broadcastActivePosUserChange();
        }

        localStorage.removeItem('pinFailedAttempts');
        setError('');

        localStorage.removeItem('pinUnlockCooldownUntil');
        setPinCooldownUntil(null);

        setCustomerDisplayPosLocked(false);
        window.dispatchEvent(new Event('tavari:session-unlocked'));
        const displayBusinessId = getCustomerDisplayBusinessId();
        if (displayBusinessId) {
          flushCustomerDisplayMirrorPush(displayBusinessId);
        }
        
        // Ensure session is still valid and restore if needed
        // Note: We don't try to restore if persistence is disabled due to 3am logout
        // The session might have expired, but that's okay - the user can continue working
        // The app-level session check will handle redirecting to login if needed
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!currentSession && sessionPersistence.isPersistenceEnabled()) {
          // Only try to restore if persistence is still enabled (not disabled by 3am check)
          try {
            const restoreResult = await sessionPersistence.restoreSession();
            if (restoreResult.restored) {
              console.log('✅ Session restored after PIN unlock');
            } else {
              console.log('⚠️ Could not restore session after PIN unlock:', restoreResult.reason);
              // Don't fail the unlock - let the user continue
              // The session might be expired, but they can still work
            }
          } catch (restoreError) {
            console.error('⚠️ Error restoring session after PIN unlock:', restoreError);
            // Don't fail the unlock - continue anyway
          }
        } else if (!currentSession) {
          console.log('ℹ️ No active session and persistence disabled - user will need to login when session expires');
          // Continue with unlock anyway - the app will handle session expiry
        }
        
        const displayName = unlockingUser?.full_name || unlockingUser?.name || unlockingUser?.first_name || profile?.full_name || profile?.first_name;
        const unlockMessage = displayName ? `Session unlocked by ${displayName}` : 'Session unlocked successfully';
        toast.success(unlockMessage);

        const returnPath = sessionStorage.getItem('unlockReturnPath');
        if (returnPath) {
          sessionStorage.removeItem('unlockReturnPath');
          navigate(returnPath);
        } else {
          navigate('/dashboard');
        }

      } else {
        if (pinResult?.reason === 'no_staff_pins' || pinResult?.reason === 'no_business') {
          setError(
            pinResult.reason === 'no_business'
              ? 'Business location not set. Sign out and log in again, or ask a manager.'
              : 'Unable to load staff PINs for this location. Ask a manager to unlock or sign out and log in again.'
          );
          setIsLoading(false);
          return;
        }

        // Failed PIN attempt
        const newFailedCount = failedAttempts + 1;
        setFailedAttempts(newFailedCount);
        localStorage.setItem('pinFailedAttempts', newFailedCount.toString());

        await recordAction('unlock', false, profile?.id);

        // Log failed attempt
        await logSecurityEvent('failed_unlock', {
          user_id: profile?.id,
          data_type: 'authentication',
          data_action: 'pin_unlock_failed',
          failed_attempt_count: newFailedCount,
          threat_type: 'authentication_failure'
        }, 'medium');

        await supabase.from('audit_logs').insert({
          user_id: profile?.id,
          business_id: getCurrentBusinessId() || null,
          event_type: 'failed_pin_login',
          details: {
            attempt: newFailedCount,
            time: new Date().toISOString(),
            device_fingerprint: securityState.deviceFingerprint,
            user_ip: securityState.userIP
          },
        });

        // Check for brute force attempts in last 10 minutes
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

        const { data: recentFailures, error: failureFetchError } = await supabase
          .from('audit_logs')
          .select('id')
          .eq('user_id', profile?.id)
          .eq('event_type', 'failed_pin_login')
          .gte('timestamp', tenMinutesAgo);

        if (!failureFetchError && recentFailures && recentFailures.length >= 3) {
          await logSecurityEvent('suspicious_activity', {
            user_id: profile?.id,
            data_type: 'threat_detection',
            data_action: 'brute_force_detected',
            threat_type: 'PIN brute force attempt',
            threat_details: {
              attempts_in_window: recentFailures.length,
              window_minutes: 10,
              user_id: profile?.id
            }
          }, 'high');

          await supabase.from('audit_logs').insert({
            user_id: profile?.id,
            business_id: getCurrentBusinessId() || null,
            event_type: 'suspicious_activity',
            details: {
              type: 'PIN brute force attempt',
              attempts: recentFailures.length,
              window: '10min',
              triggeredAt: new Date().toISOString(),
            },
          });
        }

        // Brief cooldown after 3 wrong PINs — keep the day session; do not force full logout
        if (newFailedCount >= 3) {
          const cooldownUntil = Date.now() + 2 * 60 * 1000;
          localStorage.setItem('pinUnlockCooldownUntil', cooldownUntil.toString());
          setPinCooldownUntil(cooldownUntil);
          localStorage.removeItem('pinFailedAttempts');
          setFailedAttempts(0);

          await logSecurityEvent('pin_unlock_cooldown', {
            data_type: 'security_enforcement',
            data_action: 'pin_cooldown_triggered',
            failed_attempt_count: newFailedCount
          }, 'medium');

          setError('Too many wrong PINs. Wait 2 minutes and try again. Your shift login is still active.');
          toast.error('Wait 2 minutes, then try your PIN again.');
        } else {
          setError(`Incorrect PIN. Attempt ${newFailedCount} of 3.`);
          toast.error(`Incorrect PIN. ${3 - newFailedCount} attempts remaining.`);
        }
      }

    } catch (error) {
      await logSecurityEvent('system_error', {
        user_id: profile?.id,
        error_message: error.message,
        error_stack: error.stack,
        data_type: 'authentication',
        data_action: 'unlock_system_error'
      }, 'high');
      
      setError('An unexpected error occurred. Please try again.');
      toast.error('Unlock failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle paste prevention for PIN field
  const handlePinPaste = (e) => {
    e.preventDefault();
    setError('Pasting PINs is not allowed for security reasons.');
    
    logSecurityEvent('suspicious_activity', {
      user_id: profile?.id,
      threat_type: 'pin_paste_attempt',
      data_type: 'input_validation',
      data_action: 'paste_blocked'
    }, 'low');
    
    setTimeout(() => setError(''), 3000);
  };

  const styles = {
    container: {
      ...TavariStyles.layout.flexCenter,
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray900,
      padding: TavariStyles.spacing.xl,
      fontFamily: TavariStyles.typography.fontFamily,
      position: 'relative'
    },
    
    unlockCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing['4xl'],
      maxWidth: '450px',
      width: '100%',
      textAlign: 'center',
      position: 'relative',
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    lockIcon: {
      width: '80px',
      height: '80px',
      margin: '0 auto 24px',
      backgroundColor: TavariStyles.colors.primary,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '32px',
      color: TavariStyles.colors.white
    },
    
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md,
      margin: '0 0 16px 0'
    },
    
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing['2xl'],
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    
    userInfo: {
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.xl,
      textAlign: 'left'
    },
    
    userName: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    
    sessionDetails: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    
    inputGroup: {
      marginBottom: TavariStyles.spacing.lg,
      textAlign: 'left'
    },
    
    label: {
      ...TavariStyles.components.form.label,
      textAlign: 'center',
      marginBottom: TavariStyles.spacing.md
    },
    
    pinContainer: {
      position: 'relative',
      width: '200px',
      margin: '0 auto'
    },
    
    pinInput: {
      ...TavariStyles.components.form.input,
      fontSize: '24px',
      letterSpacing: '8px',
      textAlign: 'center',
      fontFamily: 'monospace',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      width: '100%',
      boxSizing: 'border-box',
      paddingRight: '40px'
    },
    
    pinInputError: {
      borderColor: TavariStyles.colors.danger,
      boxShadow: `0 0 0 2px ${TavariStyles.colors.danger}20`,
      backgroundColor: TavariStyles.colors.errorBg
    },
    
    pinToggle: {
      position: 'absolute',
      right: '12px',
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: TavariStyles.colors.gray500,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    
    attemptsWarning: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: failedAttempts > 0 ? TavariStyles.colors.danger : TavariStyles.colors.gray500,
      marginTop: TavariStyles.spacing.sm,
      textAlign: 'center'
    },
    
    errorMessage: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.lg,
      textAlign: 'center',
      fontSize: TavariStyles.typography.fontSize.sm
    },
    
    unlockButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      width: '100%',
      marginBottom: TavariStyles.spacing.lg,
      opacity: isLoading ? 0.6 : 1,
      cursor: isLoading ? 'not-allowed' : 'pointer',
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },
    
    logoutButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.md,
      width: '100%'
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
    },
    
    backgroundPattern: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundImage: `linear-gradient(45deg, ${TavariStyles.colors.primary}10 25%, transparent 25%), 
                       linear-gradient(-45deg, ${TavariStyles.colors.primary}10 25%, transparent 25%), 
                       linear-gradient(45deg, transparent 75%, ${TavariStyles.colors.primary}10 75%), 
                       linear-gradient(-45deg, transparent 75%, ${TavariStyles.colors.primary}10 75%)`,
      backgroundSize: '20px 20px',
      backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
      opacity: 0.1,
      zIndex: 0
    }
  };

  const storedLoginUser = getStoredPosLoginUser();
  const shiftDisplayName =
    profile?.full_name ||
    profile?.email ||
    storedLoginUser?.full_name ||
    storedLoginUser?.name ||
    storedLoginUser?.email ||
    'Shift session';

  return (
    <div style={styles.container}>
      <div style={styles.backgroundPattern} />
      
      <div style={styles.unlockCard}>
        {/* Security indicator */}
        <div style={styles.securityIndicator} title={securityState.isSecure ? 'Secure Connection' : 'Security Warning'} />
        
        <div style={styles.lockIcon}>
          🔒
        </div>
        
        <h2 style={styles.title}>Session Locked</h2>
        <p style={styles.subtitle}>
          Enter any staff member&apos;s 4-digit PIN to continue working
        </p>

        {shiftContextError && (
          <div style={styles.errorMessage}>
            {shiftContextError}
          </div>
        )}
        
        {/* User Information */}
        <div style={styles.userInfo}>
          <div style={styles.userName}>
            {shiftDisplayName}
          </div>
          <div style={styles.sessionDetails}>
            <span>Auto-logout at: {sessionInfo.autoLogoutAt}</span>
            <span>Time remaining: {sessionInfo.timeLeft}</span>
            {failedAttempts > 0 && (
              <span style={{color: TavariStyles.colors.danger}}>
                Failed attempts: {failedAttempts}/3
              </span>
            )}
          </div>
        </div>

        <div style={styles.inputGroup}>
          <label style={styles.label}>Enter PIN</label>
          <div style={styles.pinContainer}>
            <input
              ref={pinInputRef}
              style={{
                ...styles.pinInput,
                ...(error ? styles.pinInputError : {})
              }}
              type={showPin ? 'text' : 'password'}
              placeholder="••••"
              value={pinInput}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '');
                if (value.length <= 4) {
                  setPinInput(value);
                }
              }}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !isLoading && pinInput.length === 4) {
                  handleUnlock();
                }
              }}
              onPaste={handlePinPaste}
              disabled={isLoading || Boolean(pinCooldownUntil && Date.now() < pinCooldownUntil)}
              maxLength={4}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <button
              type="button"
              style={styles.pinToggle}
              onClick={() => setShowPin(!showPin)}
              tabIndex={-1}
              disabled={isLoading}
            >
              {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <div style={styles.attemptsWarning}>
            {pinCooldownUntil && Date.now() < pinCooldownUntil
              ? `Wait ${Math.ceil((pinCooldownUntil - Date.now()) / 1000)}s before trying again`
              : failedAttempts === 0
                ? 'Any staff member can enter their 4-digit PIN'
                : `${3 - failedAttempts} attempts remaining`}
          </div>
        </div>

        {error && (
          <div style={styles.errorMessage}>
            {error}
          </div>
        )}

        <button 
          style={styles.unlockButton} 
          onClick={handleUnlock}
          disabled={isLoading || pinInput.length !== 4}
        >
          {isLoading && <span style={styles.loadingSpinner}></span>}
          {isLoading ? 'Verifying PIN...' : '🔓 Unlock Session'}
        </button>

        <button 
          style={styles.logoutButton} 
          onClick={() => handleForceLogout('User requested logout')}
          disabled={isLoading}
        >
          🚪 Sign Out Completely
        </button>
      </div>
      
      {/* CSS for spinner animation */}
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

// Wrap the unlock component with security
const Unlock = () => {
  return (
    <SecurityWrapper
      componentName="UnlockScreen"
      enableRateLimiting={true}
      enableDeviceTracking={true}
      enableInputValidation={true}
      enableAuditLogging={true}
      sensitiveComponent={true}
      requireSecureConnection={true}
      sessionTimeout={24 * 60 * 60 * 1000}
      securityLevel="high"
      autoBlock={false}
      showSecurityStatus={false}
      onSecurityThreat={(threat) => {
        // Security threats logged automatically
      }}
      onSessionTimeout={() => {
        // Session timeout handled by component
      }}
      onRateLimitExceeded={(blockedActions) => {
        // Rate limit events logged automatically
      }}
    >
      <UnlockComponent />
    </SecurityWrapper>
  );
};

export default Unlock;