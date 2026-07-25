/**
 * PostgREST `.or()` filter for tables keyed by either auth.users.id or public.users.id
 * (split identity). Used by employee portal user_roles checks.
 */
export function membershipUserIdOrFilter(authUserId, publicUserId) {
  if (!authUserId && !publicUserId) {
    return 'user_id.eq.00000000-0000-0000-0000-000000000000';
  }
  if (authUserId && publicUserId && authUserId !== publicUserId) {
    return `user_id.eq.${authUserId},user_id.eq.${publicUserId}`;
  }
  return `user_id.eq.${authUserId || publicUserId}`;
}
