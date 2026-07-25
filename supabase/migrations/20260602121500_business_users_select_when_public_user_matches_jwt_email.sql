-- Employee portal resolves membership with public.users.id (from email), while many RLS
-- checks use auth.uid(). When those UUIDs differ, SELECT on business_users returned no rows
-- even though a membership row exists — unless policies allow it.
--
-- A plain EXISTS() on public.users inside a policy still hits users-table RLS (invoker),
-- so split-ID accounts would fail the check. Use SECURITY DEFINER to match JWT email to
-- public.users safely.

CREATE OR REPLACE FUNCTION public.business_users_row_matches_session_email(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = p_user_id
      AND length(trim(coalesce((auth.jwt() ->> 'email')::text, ''))) > 0
      AND lower(trim(coalesce(u.email, ''))) = lower(trim(coalesce((auth.jwt() ->> 'email')::text, '')))
  );
$$;

REVOKE ALL ON FUNCTION public.business_users_row_matches_session_email(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_users_row_matches_session_email(uuid) TO authenticated;

COMMENT ON FUNCTION public.business_users_row_matches_session_email(uuid) IS
  'True when the given id is public.users.id whose email matches JWT email (split auth vs profile id; used by RLS on business_users, user_roles, users).';

ALTER TABLE IF EXISTS public.business_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "business_users_select_own_public_user_email_match" ON public.business_users;

CREATE POLICY "business_users_select_own_public_user_email_match"
ON public.business_users
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR public.business_users_row_matches_session_email(user_id)
);

-- public.users: allow reading own profile row when JWT email matches (getPublicUserId / portal)
ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_profile_when_session_email_matches" ON public.users;

CREATE POLICY "users_select_profile_when_session_email_matches"
ON public.users
FOR SELECT
TO authenticated
USING (public.business_users_row_matches_session_email(id));

-- user_roles: portal fallback uses session.user.id; rows often keyed by public.users.id
ALTER TABLE IF EXISTS public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_roles_select_when_session_email_matches_profile" ON public.user_roles;

CREATE POLICY "user_roles_select_when_session_email_matches_profile"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR public.business_users_row_matches_session_email(user_id)
);
