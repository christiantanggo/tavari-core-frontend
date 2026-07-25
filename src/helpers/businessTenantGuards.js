/**
 * Multi-tenant: opening an additional business is restricted to users who are
 * an owner on at least one existing business (business_users.role).
 */

export function isOwnerBusinessUserRole(role) {
  return String(role || '').trim().toLowerCase() === 'owner';
}

export async function userCanOpenNewBusinessTenant(supabaseClient, publicUserId) {
  if (!publicUserId) return false;
  const { data, error } = await supabaseClient
    .from('business_users')
    .select('role')
    .eq('user_id', publicUserId);
  if (error) return false;
  return (data || []).some((row) => isOwnerBusinessUserRole(row.role));
}
