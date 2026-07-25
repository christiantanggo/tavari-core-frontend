import { useCallback, useEffect, useRef } from 'react';
import bcrypt from 'bcryptjs';
import { supabase } from '../supabaseClient';

function isBcryptHash(storedPin) {
  return (
    typeof storedPin === 'string' &&
    (storedPin.startsWith('$2a$') ||
      storedPin.startsWith('$2b$') ||
      storedPin.startsWith('$2y$'))
  );
}

/** First matching staff, or null. Plaintext PINs checked instantly; bcrypt in parallel. */
async function findStaffByPin(inputPin, staffList) {
  const candidates = (staffList || []).filter((staff) => staff?.pin);
  if (!candidates.length) return null;

  for (const staff of candidates) {
    if (!isBcryptHash(staff.pin) && String(staff.pin) === String(inputPin)) {
      return staff;
    }
  }

  const hashed = candidates.filter((staff) => isBcryptHash(staff.pin));
  if (!hashed.length) return null;

  // Parallel bcrypt — wall time ≈ one compare, not N sequential compares (~10s on tablets).
  return new Promise((resolve) => {
    let remaining = hashed.length;
    let settled = false;

    hashed.forEach((staff) => {
      bcrypt
        .compare(inputPin, staff.pin)
        .then((ok) => {
          if (ok && !settled) {
            settled = true;
            resolve(staff);
          }
        })
        .catch(() => {})
        .finally(() => {
          remaining -= 1;
          if (remaining === 0 && !settled) resolve(null);
        });
    });
  });
}

export function useVendingStaffPin(businessId) {
  const cacheRef = useRef(null);
  const cachePromiseRef = useRef(null);

  const loadStaff = useCallback(async () => {
    if (!businessId) return [];

    if (cacheRef.current?.businessId === businessId) {
      return cacheRef.current.staff;
    }

    if (cachePromiseRef.current) {
      return cachePromiseRef.current;
    }

    cachePromiseRef.current = (async () => {
      try {
        const { data, error } = await supabase.rpc('get_all_staff_pins_for_unlock', {
          p_business_id: businessId
        });
        if (error) throw error;
        const staff = data || [];
        cacheRef.current = { businessId, staff };
        return staff;
      } catch (err) {
        console.warn('[vending-staff-pin] load failed', err?.message || err);
        return [];
      } finally {
        cachePromiseRef.current = null;
      }
    })();

    return cachePromiseRef.current;
  }, [businessId]);

  // Prefetch pins as soon as the kiosk knows the business — unlock stays fast.
  useEffect(() => {
    if (!businessId) return undefined;
    loadStaff().catch(() => {});
    return undefined;
  }, [businessId, loadStaff]);

  const verifyPin = useCallback(
    async (pin) => {
      if (!businessId) {
        return { ok: false, reason: 'no_business' };
      }
      const trimmed = String(pin || '').trim();
      if (trimmed.length < 4) {
        return { ok: false, reason: 'short_pin' };
      }

      const staffList = await loadStaff();
      if (!staffList.length) {
        return { ok: false, reason: 'no_staff_pins' };
      }

      const staff = await findStaffByPin(trimmed, staffList);
      if (!staff) {
        return { ok: false, reason: 'bad_pin' };
      }

      return {
        ok: true,
        employee: {
          id: staff.employee_id || staff.id,
          name: staff.full_name || staff.first_name || 'Staff'
        }
      };
    },
    [businessId, loadStaff]
  );

  return { verifyPin, prefetchPins: loadStaff };
}
