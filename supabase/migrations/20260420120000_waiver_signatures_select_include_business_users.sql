-- Align waiver_signatures read access with legacy_waivers: users linked only via
-- public.business_users (no row in user_roles) could not SELECT signed waivers.

DROP POLICY IF EXISTS waiver_signatures_select_business ON public.waiver_signatures;

CREATE POLICY waiver_signatures_select_business
  ON public.waiver_signatures
  FOR SELECT
  TO public
  USING (
    (business_id IN ( SELECT user_roles.business_id
       FROM user_roles
      WHERE user_roles.user_id = auth.uid() AND user_roles.active = true))
    OR (business_id IN ( SELECT waiver_signatures.business_id
       FROM tavari_employees
      WHERE tavari_employees.user_id = auth.uid() AND tavari_employees.is_active = true))
    OR (EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
        AND bu.business_id = waiver_signatures.business_id
    ))
  );
