import { supabase } from '../supabaseClient';

/**
 * Insert into audit_logs using the correct schema (event_type + details jsonb).
 * Uses user_profile_access when a custom action label is provided.
 */
export async function insertAuditLog({
  userId = null,
  businessId = null,
  eventType = 'user_profile_access',
  details = {},
}) {
  const { error } = await supabase.from('audit_logs').insert({
    user_id: userId,
    business_id: businessId,
    event_type: eventType,
    details,
  });

  if (error) {
    console.warn('audit_logs insert failed:', error.message);
  }

  return { error };
}
