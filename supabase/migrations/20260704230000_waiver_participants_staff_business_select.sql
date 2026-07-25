-- Staff must read portal-scoped waiver_participants (waiver_id IS NULL) linked on bookings.
-- Without this, nested booking_participants → waiver_participants joins return null for imported campers.

DROP POLICY IF EXISTS waiver_participants_select_business_staff ON public.waiver_participants;

CREATE POLICY waiver_participants_select_business_staff
  ON public.waiver_participants
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT business_id FROM public.user_roles
      WHERE user_id = auth.uid() AND active = true
    )
    OR business_id IN (
      SELECT business_id FROM public.tavari_employees
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

COMMENT ON POLICY waiver_participants_select_business_staff ON public.waiver_participants IS
  'Business staff can read portal/booking participants scoped to their business (including waiver_id IS NULL).';
