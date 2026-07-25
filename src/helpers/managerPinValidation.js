import bcrypt from 'bcryptjs';
import { supabase } from '../supabaseClient';

const ELEVATED_ROLES = new Set(['manager', 'owner', 'admin']);

async function pinMatches(pin, storedPin) {
  if (pin == null || storedPin == null) return false;
  const pinStr = String(pin);
  const stored = String(storedPin);
  if (!stored) return false;

  if (stored.startsWith('$2b$') || stored.startsWith('$2a$')) {
    try {
      return await bcrypt.compare(pinStr, stored);
    } catch {
      return pinStr === stored;
    }
  }

  return pinStr === stored;
}

/**
 * Validate PIN against any active manager/owner/admin for the business.
 * Uses SECURITY DEFINER RPC first so RLS cannot hide other managers' pins.
 * @returns {Promise<{ ok: boolean, managerId?: string, managerName?: string }>}
 */
export async function validateAnyManagerPin(businessId, pin) {
  if (!businessId || pin == null || String(pin).trim() === '') {
    return { ok: false };
  }

  try {
    const { data: staffMembers, error: staffError } = await supabase.rpc(
      'get_all_staff_pins_for_unlock',
      { p_business_id: businessId },
    );

    if (!staffError && Array.isArray(staffMembers) && staffMembers.length) {
      for (const staff of staffMembers) {
        const role = String(staff?.role || '').toLowerCase();
        if (!ELEVATED_ROLES.has(role) || !staff?.pin) continue;
        if (await pinMatches(pin, staff.pin)) {
          return {
            ok: true,
            managerId: staff.id,
            managerName: staff.full_name || staff.email || 'Manager',
          };
        }
      }
      // RPC loaded staff but no elevated pin matched — do not fall through to a
      // weaker RLS-limited query that can falsely look like "no managers".
      return { ok: false };
    }

    // Fallback when RPC is unavailable: client-side query (may be RLS-limited).
    const { data: roleRows, error: roleError } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('business_id', businessId)
      .in('role', [...ELEVATED_ROLES])
      .eq('active', true);

    if (roleError || !roleRows?.length) {
      return { ok: false };
    }

    const managerIds = [...new Set(roleRows.map((row) => row.user_id).filter(Boolean))];
    const { data: managers, error: managersError } = await supabase
      .from('users')
      .select('id, full_name, email, pin')
      .in('id', managerIds);

    if (managersError || !managers?.length) {
      return { ok: false };
    }

    for (const manager of managers) {
      if (!manager?.pin) continue;
      if (await pinMatches(pin, manager.pin)) {
        return {
          ok: true,
          managerId: manager.id,
          managerName: manager.full_name || manager.email || 'Manager',
        };
      }
    }

    return { ok: false };
  } catch (err) {
    console.error('validateAnyManagerPin:', err);
    return { ok: false };
  }
}
