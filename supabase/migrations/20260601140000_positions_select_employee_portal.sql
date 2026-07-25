-- Employee portal resolves membership with public.users.id while JWT auth.uid() may differ.
-- Positions SELECT still used auth.uid() only, so split-login employees saw empty catalogs
-- and every shift position rendered as "Unknown".

DROP POLICY IF EXISTS "Users can view positions in their business" ON public.positions;

CREATE POLICY "positions_select_business_members"
ON public.positions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = positions.business_id
      AND (
        bu.user_id = (SELECT auth.uid())
        OR public.business_users_row_matches_session_email(bu.user_id)
      )
  )
);

COMMENT ON POLICY "positions_select_business_members" ON public.positions IS
  'Business members can read position catalog; supports JWT email vs public.users.id split via business_users_row_matches_session_email.';
