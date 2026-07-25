-- Allow staff to remove today's check-in (correct mistaken selection). DELETE uses same business scope as SELECT/INSERT.

DROP POLICY IF EXISTS waiver_check_ins_delete_business ON public.waiver_participant_check_ins;

CREATE POLICY waiver_check_ins_delete_business ON public.waiver_participant_check_ins
  FOR DELETE
  USING (
    business_id IN (
      SELECT business_id FROM user_roles
      WHERE user_id = auth.uid() AND active = true
    )
    OR business_id IN (
      SELECT business_id FROM tavari_employees
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

GRANT DELETE ON public.waiver_participant_check_ins TO authenticated;
