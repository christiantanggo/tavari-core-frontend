// Helper function to get public.users.id from email
// Since business_users.user_id references public.users.id (not auth.users.id),
// we need to get the public.users.id to query business_users

import { supabase } from '../supabaseClient';

/**
 * Get public.users.id from email
 * @param {string} email - User's email address
 * @returns {Promise<string|null>} public.users.id or null if not found
 */
export async function getPublicUserId(email) {
  try {
    const normalizedEmail = email?.toLowerCase().trim() || '';

    if (normalizedEmail) {
      const { data, error } = await supabase
        .from('users')
        .select('id')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (!error && data?.id) {
        return data.id;
      }
    }

    const { data: { session } } = await supabase.auth.getSession();
    const authUserId = session?.user?.id;
    if (!authUserId) {
      if (normalizedEmail) {
        console.warn('[getPublicUserId] User not found in public.users:', normalizedEmail);
      }
      return null;
    }

    const { data: byId, error: byIdError } = await supabase
      .from('users')
      .select('id')
      .eq('id', authUserId)
      .maybeSingle();

    if (!byIdError && byId?.id) {
      return byId.id;
    }

    if (normalizedEmail) {
      console.warn('[getPublicUserId] User not found in public.users:', normalizedEmail);
    }
    return null;
  } catch (err) {
    console.error('[getPublicUserId] Error:', err);
    return null;
  }
}







