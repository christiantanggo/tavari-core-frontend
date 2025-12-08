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
import { usePOSAuth } from '../hooks/usePOSAuth';
import { useTaxCalculations } from '../hooks/useTaxCalculations';
import POSAuthWrapper from '../components/Auth/POSAuthWrapper';
import bcrypt from 'bcryptjs';
import { sessionPersistence } from '../services/SessionPersistence';
import { clearAllAuthData } from '../utils/authCleanup';

const UnlockComponent = () => {
  const { profile } = useUserProfile();
  const navigate = useNavigate();
  const [pinInput, setPinInput] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [sessionInfo, setSessionInfo] = useState({
    timeLeft: '',
    autoLogoutAt: ''
  });
  
  const pinInputRef = useRef(null);
  const employeeCacheRef = useRef(null);
  const employeeCachePromiseRef = useRef(null);

  const getCurrentBusinessId = () => localStorage.getItem('currentBusinessId');

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
        const { data: userRoles, error: rolesError } = await supabase
          .from('user_roles')
          .select('user_id, role')
          .eq('business_id', businessId)
          .eq('active', true);

        if (rolesError) {
          console.warn('Failed to load user roles for unlock cache:', rolesError.message);
          return [];
        }

        if (!userRoles || userRoles.length === 0) {
          return [];
        }

        // Dynamically derive role list from role_permissions. If none found, allow all roles present.
        let roleSet = new Set();
        try {
          const { data: rp } = await supabase
            .from('role_permissions')
            .select('role_key')
            .eq('business_id', businessId);
          if (Array.isArray(rp) && rp.length > 0) {
            roleSet = new Set(rp.map(r => r.role_key).filter(Boolean));
          }
        } catch (e) {
          // non-fatal
        }

        const authorizedUserIds = userRoles
          .filter((ur) => roleSet.size === 0 ? true : roleSet.has(ur.role))
          .map((ur) => ur.user_id)
          .filter(Boolean);

        if (authorizedUserIds.length === 0) {
          return [];
        }

        const { data: staffMembers, error: staffError } = await supabase.rpc(
          'get_staff_pins_for_unlock',
          {
            p_business_id: businessId,
            business_user_ids: authorizedUserIds
          }
        );

        if (staffError) {
          console.error('Failed to load staff pins for unlock cache:', staffError.message);
          return [];
        }

        const roleMap = new Map(userRoles.map((ur) => [ur.user_id, ur.role]));
        const employees = (staffMembers || []).map((staff) => ({
          ...staff,
          role: roleMap.get(staff.id) || 'employee',
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

  const findEmployeeByPin = useCallback(async (pin) => {
    const employees = await loadEmployeeCache();
    for (const employee of employees) {
      if (!employee?.pin) continue;
      if (await pinsMatch(pin, employee.pin)) {
        return employee;
      }
    }
    return null;
  }, [loadEmployeeCache, pinsMatch]);

  const getRoleForUser = useCallback(async (userId) => {
    if (!userId) return 'employee';
    const cache = await loadEmployeeCache();
    const cached = cache.find((employee) => employee.id === userId);
    if (cached?.role) {
      return cached.role;
    }

    try {
      const businessId = getCurrentBusinessId();
      if (!businessId) return 'employee';

      const { data, error } = await supabase
        .from('business_users')
        .select('role')
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.warn('Unable to resolve role for user:', error.message);
        return 'employee';
      }

      return data?.role || 'employee';
    } catch (err) {
      console.warn('Failed to fetch role for user:', err?.message || err);
      return 'employee';
    }
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
  // This prevents logout while the timeout modal is visible
  useEffect(() => {
    // Ensure session persistence is enabled
    if (sessionPersistence.isPersistenceEnabled()) {
      sessionPersistence.startAutoRefresh();
    }
    
    return () => {
      // Don't stop refresh on unmount - let it continue
    };
  }, []);

  // Load failed attempts from localStorage
  useEffect(() => {
    const storedAttempts = parseInt(localStorage.getItem('pinFailedAttempts') || '0', 10);
    setFailedAttempts(storedAttempts);

    // Update session info
    updateSessionInfo();
    const interval = setInterval(updateSessionInfo, 1000);
    
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
      clearAllAuthData('forced_logout');
      
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
      clearAllAuthData('logout_error');
      navigate('/login');
    }
  };

  const handleUnlock = async () => {
    if (isLoading) return;
    
    setError('');
    setIsLoading(true);
    clearValidationErrors();

    try {
      // Check for daily logout requirement
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const isAfter3am = currentHour > 3 || (currentHour === 3 && currentMinute > 0);
      const today = now.toISOString().split('T')[0];
      const lastForcedLogout = localStorage.getItem('lastForcedLogout');

      if (isAfter3am && lastForcedLogout !== today) {
        await handleForceLogout('Daily security logout (after 3 AM)');
        return;
      }

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

      let storedPin = profile?.pin;
      if (!storedPin && profile?.id) {
        const { data: userRow } = await supabase
          .from('users')
          .select('pin')
          .eq('id', profile.id)
          .maybeSingle();

        storedPin = userRow?.pin;
      }

      let unlockingUser = profile;
      let pinMatches = false;

      // Verify against logged-in user's PIN first
      if (await pinsMatch(pinInput, storedPin)) {
        pinMatches = true;
      } else {
        // Attempt to match against any other employee for this business
        const alternateUser = await findEmployeeByPin(pinInput);
        if (alternateUser) {
          unlockingUser = alternateUser;
          pinMatches = true;
        }
      }

      if (!pinMatches) {
        // Failed attempt, existing logic handles below
      }

      if (pinMatches && unlockingUser) {
        const effectiveRole = unlockingUser.role || await getRoleForUser(unlockingUser.id);
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
        await supabase.from('audit_logs').insert([
          {
            user_id: unlockingUser?.id || profile?.id,
            event_type: 'pin_login',
            details: {
              method: 'unlock_screen',
              time: new Date().toISOString(),
              device_fingerprint: securityState.deviceFingerprint,
              user_ip: securityState.userIP
            },
          },
          {
            user_id: unlockingUser?.id || profile?.id,
            event_type: 'pin_unlock',
            details: {
              method: 'unlock_screen',
              time: new Date().toISOString(),
              device_fingerprint: securityState.deviceFingerprint,
              user_ip: securityState.userIP
            },
          }
        ]);

        // Track which employee unlocked the register so POS can attribute sales
        const businessId = getCurrentBusinessId();
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
          broadcastActivePosUserChange();
        }

        // Clear failed attempts
        localStorage.removeItem('pinFailedAttempts');
        setError('');
        
        // Ensure session is still valid and restore if needed
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!currentSession && sessionPersistence.isPersistenceEnabled()) {
          // Try to restore session before navigating
          const restoreResult = await sessionPersistence.restoreSession();
          if (restoreResult.restored) {
            console.log('✅ Session restored after PIN unlock');
          } else {
            console.warn('⚠️ Could not restore session after PIN unlock');
          }
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
            event_type: 'suspicious_activity',
            details: {
              type: 'PIN brute force attempt',
              attempts: recentFailures.length,
              window: '10min',
              triggeredAt: new Date().toISOString(),
            },
          });
        }

        // Handle lockout after 3 failed attempts
        if (newFailedCount >= 3) {
          await logSecurityEvent('account_lockout', {
            user_id: profile?.id,
            data_type: 'security_enforcement',
            data_action: 'pin_lockout_triggered',
            threat_type: 'brute_force_protection',
            failed_attempt_count: newFailedCount
          }, 'high');

          toast.error('Account locked. Please log in again.');
          await handleForceLogout(`Account locked after ${newFailedCount} failed PIN attempts`);
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
          Enter your 4-digit PIN to continue working
        </p>
        
        {/* User Information */}
        <div style={styles.userInfo}>
          <div style={styles.userName}>
            {profile?.full_name || profile?.email || 'Current User'}
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
              disabled={isLoading}
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
            {failedAttempts === 0 
              ? 'Enter your 4-digit PIN'
              : `${3 - failedAttempts} attempts remaining`
            }
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
      sessionTimeout={5 * 60 * 1000} // 5 minutes
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
      <POSAuthWrapper
        requiredRoles={['owner', 'manager', 'admin', 'employee']}
        requireBusiness={false}
        componentName="UnlockScreen"
      >
        <UnlockComponent />
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default Unlock;