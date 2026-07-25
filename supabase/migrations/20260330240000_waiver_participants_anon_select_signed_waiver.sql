-- Public waiver kiosk (anon): read participant rows for OTP routing and on-file view.
--
-- Problem: `waiver_participants_select_anon_portal` (if applied) only allows
--   customer_id IS NOT NULL AND business_id IS NOT NULL.
-- WaiverSubmissionService inserts additional adults with waiver_id + phone/email but often
-- WITHOUT customer_id/business_id → anon SELECT returned zero rows → additional adult never matched → wrong/error OTP.
--
-- `waiver_participants_select` (waivers_rls_participants_policies) allows public read only when the parent
-- waiver_signatures row has signature_token IS NOT NULL. If production clears the token after sign, anon
-- cannot see participants either.
--
-- This policy ORs in: anon may read participants tied to a completed waiver (signed_at set).

ALTER TABLE public.waiver_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "waiver_participants_select_anon_signed_waiver" ON public.waiver_participants;

CREATE POLICY "waiver_participants_select_anon_signed_waiver"
  ON public.waiver_participants
  FOR SELECT
  TO anon
  USING (
    waiver_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.waiver_signatures ws
      WHERE ws.id = waiver_participants.waiver_id
        AND ws.signed_at IS NOT NULL
    )
  );

COMMENT ON POLICY "waiver_participants_select_anon_signed_waiver" ON public.waiver_participants IS
  'Public kiosk: read participants for signed waivers so phone/email OTP routing sees additional adults.';
