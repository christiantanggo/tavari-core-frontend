// hooks/useSessionLock.js
// Updated with multi-staff PIN support for employee, cashier, manager, owner, admin roles
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { logAction } from '../helpers/posAudit';
import bcrypt from 'bcryptjs';

// AUTO-LOCK AFTER 5 MINUTES OF INACTIVITY
const AUTO_LOCK_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
const WARNING_WINDOW_MS = 0; // No warning window

export function useSessionLock() {
  const [isLocked, setIsLocked] = useState(false);
  const [warningSeconds, setWarningSeconds] = useState(null); // null or countdown int
  const [pinAttempts, setPinAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null); // timestamp during lockout after 3 failed attempts
  const [overrideActiveUntil, setOverrideActiveUntil] = useState(null); // manager override window (30s)

  const timerRef = useRef(null);
  const warningIntervalRef = useRef(null);

  const clearTimers = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (warningIntervalRef.current) clearInterval(warningIntervalRef.current);
    warningIntervalRef.current = null;
    timerRef.current = null;
    setWarningSeconds(null); // Clear the warning display
  };

  const startInactivityTimer = useCallback(() => {
    clearTimers();

    // Set timer to lock after inactivity period
    timerRef.current = setTimeout(() => {
      setIsLocked(true);
      clearTimers();
      
      // Set flag in localStorage for navigation handler
      localStorage.setItem('tavari_session_locked', 'true');
      
      // Dispatch custom event for immediate navigation
      window.dispatchEvent(new CustomEvent('tavari:session-locked'));
    }, AUTO_LOCK_MS);
  }, []);

  const registerActivity = useCallback(() => {
    if (isLocked) return; // ignore when locked
    startInactivityTimer();
  }, [isLocked, startInactivityTimer]);

  // public API: call to lock immediately (e.g., manual)
  const lock = useCallback(async () => {
    setIsLocked(true);
    await logAction({ action: 'lock', context: 'useSessionLock' });
    clearTimers();
    try {
      localStorage.setItem('tavari_session_locked', 'true');
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('tavari:session-locked'));
  }, []);

  // PIN validation - checks ONLY the original logged-in user's PIN (full session unlock)
  // NOTE: For register-only unlock, see POSRegister.jsx which checks all employees
  const validatePin = async (pin) => {
    console.log('🔒 [SessionLock] ========== SESSION LOCK UNLOCK - PIN VALIDATION ==========');
    console.log('🔒 [SessionLock] Checking PIN for ORIGINAL logged-in user only (full session unlock)');
    
    const bizId = localStorage.getItem('currentBusinessId');
    console.log('🔒 [SessionLock] Business ID:', bizId);
    console.log('🔒 [SessionLock] PIN input length:', pin?.length);
    
    if (!bizId || !pin) {
      console.error('❌ [SessionLock] Missing business ID or PIN:', { bizId: !!bizId, pin: !!pin });
      return false;
    }

    try {
      // Get the original logged-in user ID from the session
      console.log('🔒 [SessionLock] Checking session for original user...');
      const { data: { session } } = await supabase.auth.getSession();
      const originalUserId = session?.user?.id;
      
      console.log('🔒 [SessionLock] Session data:', {
        hasSession: !!session,
        sessionUserId: originalUserId,
        sessionEmail: session?.user?.email,
        sessionExpires: session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null
      });

      if (!originalUserId) {
        console.error('❌ [SessionLock] No original logged-in user ID found - cannot validate PIN');
        console.error('❌ [SessionLock] This means either:');
        console.error('❌ [SessionLock] 1. Session has expired');
        console.error('❌ [SessionLock] 2. User is not logged in');
        console.error('❌ [SessionLock] 3. Session data is corrupted');
        await logAction({ 
          action: 'session_unlock_failed', 
          context: 'useSessionLock', 
          metadata: { 
            reason: 'no_session_user_id',
            hasSession: !!session
          } 
        });
        return false;
      }

      console.log('🔒 [SessionLock] Fetching original user data from database...');
      // Get ONLY the original user's PIN (not all employees)
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, full_name, email, pin')
        .eq('id', originalUserId)
        .maybeSingle();

      console.log('🔒 [SessionLock] Database query result:', {
        foundUser: !!userData,
        userId: userData?.id,
        email: userData?.email,
        hasPin: !!userData?.pin,
        pinType: userData?.pin ? (userData.pin.startsWith('$2b$') || userData.pin.startsWith('$2a$') ? 'hashed' : 'plain') : 'none',
        error: userError?.message || null
      });

      if (userError) {
        console.error('❌ [SessionLock] Database error fetching user:', userError);
        console.error('❌ [SessionLock] Error details:', {
          message: userError.message,
          code: userError.code,
          details: userError.details,
          hint: userError.hint
        });
        return false;
      }

      if (!userData) {
        console.error('❌ [SessionLock] User not found in database:', originalUserId);
        await logAction({ 
          action: 'session_unlock_failed', 
          context: 'useSessionLock', 
          metadata: { 
            reason: 'user_not_found',
            user_id: originalUserId
          } 
        });
        return false;
      }

      if (!userData.pin) {
        console.error('❌ [SessionLock] Original user has no PIN set:', {
          userId: userData.id,
          email: userData.email
        });
        await logAction({ 
          action: 'session_unlock_failed', 
          context: 'useSessionLock', 
          metadata: { 
            reason: 'no_pin_set',
            user_id: originalUserId
          } 
        });
        return false;
      }

      console.log('🔒 [SessionLock] Comparing PIN...');
      console.log('🔒 [SessionLock] Input PIN length:', pin?.length);
      console.log('🔒 [SessionLock] Stored PIN type:', userData.pin.startsWith('$2b$') || userData.pin.startsWith('$2a$') ? 'hashed' : 'plain');
      
      // Check if PIN matches (hashed or plain text)
      let pinMatches = false;
      if (userData.pin.startsWith('$2b$') || userData.pin.startsWith('$2a$')) {
        // Hashed PIN
        console.log('🔒 [SessionLock] Comparing hashed PIN using bcrypt...');
        pinMatches = await bcrypt.compare(String(pin), userData.pin);
        console.log('🔒 [SessionLock] bcrypt.compare result:', pinMatches);
      } else {
        // Plain text PIN (for legacy compatibility)
        console.log('🔒 [SessionLock] Comparing plain text PIN...');
        pinMatches = String(userData.pin) === String(pin);
        console.log('🔒 [SessionLock] Plain text comparison result:', pinMatches);
      }

      if (pinMatches) {
        console.log('✅ [SessionLock] PIN MATCHED - Session unlock authorized');
        console.log('✅ [SessionLock] Unlocking user:', {
          id: userData.id,
          email: userData.email,
          name: userData.full_name
        });
        
        await logAction({ 
          action: 'session_unlock_success', 
          context: 'useSessionLock', 
          metadata: { 
            unlocked_by_id: userData.id,
            unlocked_by_name: userData.full_name || userData.email,
            unlock_method: 'pin',
            note: 'Original logged-in user PIN'
          } 
        });
        console.log('🔒 [SessionLock] ============================================');
        return true;
      } else {
        console.log('❌ [SessionLock] PIN DID NOT MATCH');
        console.log('❌ [SessionLock] This is correct behavior - only original user can unlock full session');
        await logAction({ 
          action: 'session_unlock_failed', 
          context: 'useSessionLock', 
          metadata: { 
            pin_length: String(pin).length,
            user_id: originalUserId,
            note: 'PIN did not match original user'
          } 
        });
        console.log('🔒 [SessionLock] ============================================');
        return false;
      }

    } catch (error) {
      console.error('❌ [SessionLock] Exception during PIN validation:', error);
      console.error('❌ [SessionLock] Error message:', error.message);
      console.error('❌ [SessionLock] Stack trace:', error.stack);
      await logAction({ 
        action: 'session_unlock_error', 
        context: 'useSessionLock', 
        metadata: { 
          error: error.message,
          stack: error.stack
        } 
      });
      console.log('🔒 [SessionLock] ============================================');
      return false;
    }
  };

  // Manager override check - includes manager, owner, admin roles
  const validateManagerPin = async (pin) => {
    const bizId = localStorage.getItem('currentBusinessId');
    if (!bizId || !pin) return false;

    try {

      const { data, error } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('business_id', bizId)
        .in('role', ['manager', 'owner', 'admin']) // Include owner and admin
        .eq('active', true);

      if (error || !data || data.length === 0) {
        return false;
      }

      const managerIds = data.map(r => r.user_id);
      const { data: managers, error: managersError } = await supabase
        .from('users')
        .select('id, full_name, email, pin')
        .in('id', managerIds);

      if (managersError || !managers) {
        console.error('SessionLock: Error fetching managers:', managersError);
        return false;
      }

      // Check PIN against all managers/owners/admins
      for (const manager of managers) {
        if (!manager.pin) continue;

        // Check if PIN is hashed or plain text
        if (manager.pin.startsWith('$2b$') || manager.pin.startsWith('$2a$')) {
          // Hashed PIN
          const matches = await bcrypt.compare(String(pin), manager.pin);
          if (matches) {
            await logAction({ 
              action: 'manager_override_success', 
              context: 'useSessionLock', 
              metadata: { 
                override_by_id: manager.id,
                override_by_name: manager.full_name || manager.email
              } 
            });
            return true;
          }
        } else {
          // Plain text PIN
          const matches = String(manager.pin) === String(pin);
          if (matches) {
            await logAction({ 
              action: 'manager_override_success', 
              context: 'useSessionLock', 
              metadata: { 
                override_by_id: manager.id,
                override_by_name: manager.full_name || manager.email
              } 
            });
            return true;
          }
        }
      }

      await logAction({ 
        action: 'manager_override_failed', 
        context: 'useSessionLock', 
        metadata: { 
          managers_checked: managers.length
        } 
      });
      return false;

    } catch (error) {
      console.error('SessionLock: Manager override error:', error);
      return false;
    }
  };

  const unlockWithPin = useCallback(async (pin) => {
    // lockout window?
    if (lockedUntil && Date.now() < lockedUntil) {
      const ms = lockedUntil - Date.now();
      return { ok: false, reason: 'locked_out', msRemaining: ms };
    }

    const ok = await validatePin(pin);
    if (ok) {
      setIsLocked(false);
      setPinAttempts(0);
      setLockedUntil(null);
      setWarningSeconds(null);
      
      // Clear lock flag
      localStorage.removeItem('tavari_session_locked');
      
      // Dispatch custom event for unlock
      window.dispatchEvent(new CustomEvent('tavari:session-unlocked'));
      
      startInactivityTimer();
      return { ok: true };
    } else {
      const next = pinAttempts + 1;
      setPinAttempts(next);
      await logAction({ 
        action: 'unlock_attempt_failed', 
        context: 'useSessionLock', 
        metadata: { attempts: next } 
      });
      if (next >= 3) {
        const fiveMin = 5 * 60 * 1000;
        const until = Date.now() + fiveMin;
        setLockedUntil(until);
        await logAction({ 
          action: 'pin_lockout', 
          context: 'useSessionLock', 
          metadata: { minutes: 5 } 
        });
      }
      return { ok: false, reason: 'bad_pin' };
    }
  }, [pinAttempts, lockedUntil, startInactivityTimer]);

  const managerOverride = useCallback(async (pin, reason) => {
    const ok = await validateManagerPin(pin);
    if (ok) {
      setOverrideActiveUntil(Date.now() + 30_000); // 30s
      await logAction({ 
        action: 'manager_override', 
        context: 'useSessionLock', 
        metadata: { reason, window_s: 30 } 
      });
    }
    return ok;
  }, []);

  // Expose an isOverrideActive helper
  const isOverrideActive = () => !!(overrideActiveUntil && Date.now() < overrideActiveUntil);

  // Bind global listeners on POS screens only
  useEffect(() => {
    const events = ['mousemove', 'keydown', 'click', 'touchstart'];
    const handler = () => registerActivity();
    events.forEach(e => window.addEventListener(e, handler));
    startInactivityTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, handler));
      clearTimers();
    };
  }, [registerActivity, startInactivityTimer]);

  return {
    isLocked,
    warningSeconds,
    pinAttempts,
    lockedUntil,
    lock,
    unlockWithPin,
    managerOverride,
    isOverrideActive,
    registerActivity, // expose in case components want to ping
  };
}