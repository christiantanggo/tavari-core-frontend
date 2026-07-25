-- Allow staff check-ins for imported legacy waivers without forcing legacy rows into waiver_signatures.

ALTER TABLE public.waiver_participant_check_ins
  ADD COLUMN IF NOT EXISTS legacy_waiver_id uuid REFERENCES public.legacy_waivers(id) ON DELETE CASCADE;

ALTER TABLE public.waiver_participant_check_ins
  ADD COLUMN IF NOT EXISTS legacy_participant_key text;

ALTER TABLE public.waiver_participant_check_ins
  ALTER COLUMN waiver_id DROP NOT NULL;

ALTER TABLE public.waiver_participant_check_ins
  DROP CONSTRAINT IF EXISTS waiver_check_ins_one_source;

ALTER TABLE public.waiver_participant_check_ins
  ADD CONSTRAINT waiver_check_ins_one_source
  CHECK (
    (waiver_id IS NOT NULL AND legacy_waiver_id IS NULL)
    OR (waiver_id IS NULL AND legacy_waiver_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_waiver_check_ins_legacy_waiver_time
  ON public.waiver_participant_check_ins (legacy_waiver_id, checked_in_at DESC)
  WHERE legacy_waiver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_waiver_check_ins_legacy_participant
  ON public.waiver_participant_check_ins (legacy_waiver_id, legacy_participant_key, checked_in_at DESC)
  WHERE legacy_waiver_id IS NOT NULL;

COMMENT ON COLUMN public.waiver_participant_check_ins.legacy_waiver_id IS
  'Target imported legacy_waivers row when check-in is for a legacy/imported waiver.';

COMMENT ON COLUMN public.waiver_participant_check_ins.legacy_participant_key IS
  'Stable UI participant key for imported legacy waiver people whose source rows are not waiver_participants UUIDs.';
