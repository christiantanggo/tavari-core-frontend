-- Reputation: configurable waiver check-in review emails (delay, adults only) + queue for scheduled sends
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.reputation_settings
  ADD COLUMN IF NOT EXISTS waiver_check_in_review_email_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.reputation_settings
  ADD COLUMN IF NOT EXISTS waiver_check_in_review_delay_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE public.reputation_settings
  ADD COLUMN IF NOT EXISTS waiver_check_in_review_adults_only boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reputation_settings_waiver_check_in_review_delay_minutes_check'
  ) THEN
    ALTER TABLE public.reputation_settings
      ADD CONSTRAINT reputation_settings_waiver_check_in_review_delay_minutes_check
      CHECK (waiver_check_in_review_delay_minutes >= 0 AND waiver_check_in_review_delay_minutes <= 10080);
  END IF;
END $$;

COMMENT ON COLUMN public.reputation_settings.waiver_check_in_review_email_enabled IS
  'When true, a thank-you / review request email can be sent after a waiver check-in (requires Mail automation waiver_check_in_review).';
COMMENT ON COLUMN public.reputation_settings.waiver_check_in_review_delay_minutes IS
  'Minutes to wait after check-in before sending the review email. 0 = send as soon as check-in is recorded.';
COMMENT ON COLUMN public.reputation_settings.waiver_check_in_review_adults_only IS
  'When true, skip automated emails for check-ins where subject_type is minor.';

-- Queue for delayed sends (processed by Edge Function on a schedule)
CREATE TABLE IF NOT EXISTS public.reputation_waiver_checkin_email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  check_in_id uuid NOT NULL REFERENCES public.waiver_participant_check_ins (id) ON DELETE CASCADE,
  send_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT reputation_waiver_checkin_email_queue_check_in_unique UNIQUE (check_in_id)
);

CREATE INDEX IF NOT EXISTS idx_reputation_waiver_checkin_q_due
  ON public.reputation_waiver_checkin_email_queue (status, send_at)
  WHERE status = 'pending';

ALTER TABLE public.reputation_waiver_checkin_email_queue ENABLE ROW LEVEL SECURITY;

-- No policies: deny authenticated; service role bypasses RLS
INSERT INTO public.system_runtime_secrets (key_name, secret_value)
VALUES (
  'waiver_check_in_review_queue_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (key_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trigger_reputation_waiver_checkin_email_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  project_url text := COALESCE(
    NULLIF(current_setting('app.settings.supabase_url', true), ''),
    'https://iagcamwcfuiopmwefohz.supabase.co'
  );
  q_secret text;
BEGIN
  SELECT secret_value
  INTO q_secret
  FROM public.system_runtime_secrets
  WHERE key_name = 'waiver_check_in_review_queue_secret';

  IF q_secret IS NULL OR q_secret = '' THEN
    RAISE EXCEPTION 'waiver_check_in_review_queue_secret is not configured';
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/mail-waiver-check-in-automation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-waiver-review-queue-secret', q_secret
    ),
    body := jsonb_build_object('action', 'processQueue'),
    timeout_milliseconds := 120000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_reputation_waiver_checkin_email_queue() FROM PUBLIC;

-- Every 2 minutes: send due waiver review emails
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'reputation-waiver-checkin-review-queue'
  ) THEN
    PERFORM cron.unschedule('reputation-waiver-checkin-review-queue');
  END IF;

  PERFORM cron.schedule(
    'reputation-waiver-checkin-review-queue',
    '*/2 * * * *',
    'SELECT public.trigger_reputation_waiver_checkin_email_queue();'
  );
END $$;
