-- Employee portal uses public.users.id for business_users.user_id while JWT auth.uid() may differ.
-- Align scheduling_events SELECT with business_users (see business_users_row_matches_session_email).

DROP POLICY IF EXISTS "Users can view events in their business" ON public.scheduling_events;

CREATE POLICY "scheduling_events_select_business_members"
ON public.scheduling_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.business_users bu
    WHERE bu.business_id = scheduling_events.business_id
      AND (
        bu.user_id = (SELECT auth.uid())
        OR public.business_users_row_matches_session_email(bu.user_id)
      )
  )
);

COMMENT ON POLICY "scheduling_events_select_business_members" ON public.scheduling_events IS
  'Employees and managers can read business schedule events when linked via business_users (auth.uid or JWT email match to public.users).';
