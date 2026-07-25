-- Employee portal updates public.users using public.users.id (from getPublicUserId).
-- Existing policy "Users can update their own record" only allows auth.uid() = id.
-- When auth.users.id != public.users.id, UPDATE matched 0 rows — profile saves appeared to work but did not persist.
--
-- Add a permissive UPDATE policy OR'd with the existing one: same helper as SELECT (JWT email matches profile row).

DROP POLICY IF EXISTS "users_update_when_jwt_email_matches_public_profile" ON public.users;

CREATE POLICY "users_update_when_jwt_email_matches_public_profile"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (public.business_users_row_matches_session_email(id))
  WITH CHECK (public.business_users_row_matches_session_email(id));

COMMENT ON POLICY "users_update_when_jwt_email_matches_public_profile" ON public.users IS
  'Allows updating the public.users row whose email matches the JWT when auth.uid() differs from public.users.id (employee portal).';
