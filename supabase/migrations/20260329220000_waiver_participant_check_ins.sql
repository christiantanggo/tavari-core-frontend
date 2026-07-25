-- Per-person check-in events for waivers (primary signer, minors, additional adults).
-- Append-only log: who was checked in, when (timestamp), by which staff user.

CREATE TABLE IF NOT EXISTS waiver_participant_check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  waiver_id UUID NOT NULL REFERENCES waiver_signatures(id) ON DELETE CASCADE,
  -- NULL = primary signer when they are only on waiver_signatures (no participant row)
  waiver_participant_id UUID REFERENCES waiver_participants(id) ON DELETE SET NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('primary_signer', 'minor', 'additional_adult')),
  display_name TEXT NOT NULL,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_in_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waiver_check_ins_business_time
  ON waiver_participant_check_ins (business_id, checked_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_waiver_check_ins_waiver_time
  ON waiver_participant_check_ins (waiver_id, checked_in_at DESC);

COMMENT ON TABLE waiver_participant_check_ins IS 'Staff check-in events per person on a waiver (date/time audit trail).';
COMMENT ON COLUMN waiver_participant_check_ins.waiver_participant_id IS 'Target participant row; NULL with subject_type primary_signer means signer is only on waiver_signatures.';

ALTER TABLE waiver_participant_check_ins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS waiver_check_ins_select_business ON waiver_participant_check_ins;
DROP POLICY IF EXISTS waiver_check_ins_insert_business ON waiver_participant_check_ins;

CREATE POLICY waiver_check_ins_select_business ON waiver_participant_check_ins
  FOR SELECT
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

CREATE POLICY waiver_check_ins_insert_business ON waiver_participant_check_ins
  FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT business_id FROM user_roles
      WHERE user_id = auth.uid() AND active = true
    )
    OR business_id IN (
      SELECT business_id FROM tavari_employees
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

GRANT SELECT, INSERT ON public.waiver_participant_check_ins TO authenticated;
