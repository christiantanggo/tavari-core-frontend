-- Employee portal resolves membership with public.users.id (from email), while JWT auth.uid()
-- may differ when an employee has multiple auth accounts (e.g. outlook vs gmail).
-- scheduling_events was fixed in 20260615140000; align scheduling_shifts SELECT the same way.

DROP POLICY IF EXISTS "Users can view published shifts or their own unpublished shifts" ON public.scheduling_shifts;
DROP POLICY IF EXISTS "Users can view shifts in their business" ON public.scheduling_shifts;

CREATE POLICY "scheduling_shifts_select_business_members"
ON public.scheduling_shifts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = scheduling_shifts.business_id
      AND (
        bu.user_id = (SELECT auth.uid())
        OR public.business_users_row_matches_session_email(bu.user_id)
      )
  )
  AND (
    scheduling_shifts.is_published = true
    OR scheduling_shifts.created_by = (SELECT auth.uid())
    OR public.business_users_row_matches_session_email(scheduling_shifts.created_by)
  )
);

COMMENT ON POLICY "scheduling_shifts_select_business_members" ON public.scheduling_shifts IS
  'Business members can read published shifts; creators can read their unpublished drafts. Supports JWT email vs public.users.id split via business_users_row_matches_session_email.';
