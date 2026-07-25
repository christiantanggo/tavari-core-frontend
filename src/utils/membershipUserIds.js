import { supabase } from '../supabaseClient';
import { getPublicUserId } from './getPublicUserId';
import { membershipUserIdOrFilter } from './employeePortalMembership';

/**
 * Resolve auth.users.id and public.users.id for membership queries.
 * Many tables key user_id to either id depending on provisioning history.
 */
export async function resolveMembershipUserIds(authUser = null) {
  let user = authUser;
  if (!user) {
    const { data: { user: fetched } } = await supabase.auth.getUser();
    user = fetched;
  }
  if (!user?.id) {
    return null;
  }

  const publicUserId = (await getPublicUserId(user.email)) || user.id;
  const membershipIds = [...new Set([user.id, publicUserId].filter(Boolean))];

  return {
    authUserId: user.id,
    publicUserId,
    membershipIds,
    membershipFilter: membershipUserIdOrFilter(user.id, publicUserId),
    email: user.email,
  };
}

/** Pick the id used in public.users for profile/PIN updates. */
export function profileUserIdFromMembership(ids) {
  if (!ids) return null;
  return ids.publicUserId || ids.authUserId || null;
}
