-- Client submission id for idempotent waiver inserts + dashboard Realtime
ALTER TABLE public.waiver_signatures
  ADD COLUMN IF NOT EXISTS client_submission_id uuid;

COMMENT ON COLUMN public.waiver_signatures.client_submission_id IS
  'Client-generated UUID for this submission; unique when set (kiosk + portal dedup / verify).';

CREATE UNIQUE INDEX IF NOT EXISTS waiver_signatures_client_submission_id_uidx
  ON public.waiver_signatures (client_submission_id)
  WHERE client_submission_id IS NOT NULL;

-- Dashboard: live waiver list updates (INSERT/UPDATE/DELETE) for subscribed clients
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'waiver_signatures'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.waiver_signatures;
  END IF;
END $$;
