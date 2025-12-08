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
  }, []);

  // Multi-staff PIN validation - allows any authorized staff member to unlock
  const validatePin = async (pin) => {
    const bizId = localStorage.getItem('currentBusinessId');
    if (!bizId || !pin) return false;

    try {

      // Get all authorized users for this business
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .eq('business_id', bizId)
        .eq('active', true);

      if (rolesError) {
        console.error('SessionLock: Error fetching user roles:', rolesError);
        return false;
      }

      if (!userRoles || userRoles.length === 0) {
        return false;
      }

      // Allow employee, cashier, manager, owner, admin
      const allowedRoles = ['employee', 'cashier', 'manager', 'owner', 'admin'];
      const authorizedUserIds = userRoles
        .filter(ur => allowedRoles.includes(ur.role))
        .map(ur => ur.user_id);


      if (authorizedUserIds.length === 0) {
        return false;
      }

      // Get user data for all authorized users
      const { data: staffMembers, error: staffError } = await supabase
        .from('users')
        .select('id, full_name, email, pin')
        .in('id', authorizedUserIds);

      if (staffError) {
        console.error('SessionLock: Error fetching staff:', staffError);
        return false;
      }

      if (!staffMembers || staffMembers.length === 0) {
        return false;
      }

      // Check PIN against all authorized staff members
      for (const staff of staffMembers) {
        if (!staff.pin) {
          continue;
        }

        // Check if PIN is hashed or plain text
        if (staff.pin.startsWith('$2b$') || staff.pin.startsWith('$2a$')) {
          // Hashed PIN
          const matches = await bcrypt.compare(String(pin), staff.pin);
          if (matches) {
            await logAction({ 
              action: 'session_unlock_success', 
              context: 'useSessionLock', 
              metadata: { 
                unlocked_by_id: staff.id,
                unlocked_by_name: staff.full_name || staff.email,
                unlock_method: 'pin'
              } 
            });
            return true;
          }
        } else {
          // Plain text PIN (for legacy compatibility)
          const matches = String(staff.pin) === String(pin);
          if (matches) {
            await logAction({ 
              action: 'session_unlock_success', 
              context: 'useSessionLock', 
              metadata: { 
                unlocked_by_id: staff.id,
                unlocked_by_name: staff.full_name || staff.email,
                unlock_method: 'pin'
              } 
            });
            return true;
          }
        }
      }
      await logAction({ 
        action: 'session_unlock_failed', 
        context: 'useSessionLock', 
        metadata: { 
          pin_length: String(pin).length,
          staff_checked: staffMembers.length
        } 
      });
      return false;

    } catch (error) {
      console.error('SessionLock: PIN validation error:', error);
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