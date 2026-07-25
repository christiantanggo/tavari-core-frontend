-- booking_activity_schedules RLS was missing 'admin' (other booking tables include it).
-- Without this, delete/insert/update silently affect 0 rows for admin users.

DROP POLICY IF EXISTS "Managers and owners can create activity schedules" ON public.booking_activity_schedules;
CREATE POLICY "Managers and owners can create activity schedules"
  ON public.booking_activity_schedules
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_activity_schedules.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('manager', 'owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Managers and owners can update activity schedules" ON public.booking_activity_schedules;
CREATE POLICY "Managers and owners can update activity schedules"
  ON public.booking_activity_schedules
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_activity_schedules.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('manager', 'owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_activity_schedules.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('manager', 'owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Managers and owners can delete activity schedules" ON public.booking_activity_schedules;
CREATE POLICY "Managers and owners can delete activity schedules"
  ON public.booking_activity_schedules
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_activity_schedules.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('manager', 'owner', 'admin')
    )
  );
