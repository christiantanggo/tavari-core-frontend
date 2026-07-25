-- Allow household members to read each other's display names (for expense labels, calendar, etc.)

CREATE OR REPLACE FUNCTION public.pullcoparent_shares_household_with(p_other_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pullcoparent_household_members AS mine
    INNER JOIN public.pullcoparent_household_members AS theirs
      ON mine.household_id = theirs.household_id
    WHERE mine.user_id = auth.uid()
      AND theirs.user_id = p_other_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.pullcoparent_shares_household_with(uuid) TO authenticated;

DROP POLICY IF EXISTS pullcoparent_profiles_select_household_member ON public.pullcoparent_profiles;
CREATE POLICY pullcoparent_profiles_select_household_member ON public.pullcoparent_profiles
  FOR SELECT TO authenticated
  USING (public.pullcoparent_shares_household_with(user_id));
