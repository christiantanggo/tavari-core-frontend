CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.system_runtime_secrets (
  key_name text PRIMARY KEY,
  secret_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.system_runtime_secrets ENABLE ROW LEVEL SECURITY;

INSERT INTO public.system_runtime_secrets (key_name, secret_value)
VALUES (
  'mail_process_schedules_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (key_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trigger_mail_process_schedules()
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
  schedule_secret text;
BEGIN
  SELECT secret_value
  INTO schedule_secret
  FROM public.system_runtime_secrets
  WHERE key_name = 'mail_process_schedules_secret';

  IF schedule_secret IS NULL OR schedule_secret = '' THEN
    RAISE EXCEPTION 'mail_process_schedules_secret is not configured';
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/mail-process-schedules',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mail-schedule-secret', schedule_secret
    ),
    body := '{"batchSize":100}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_mail_process_schedules() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'mail-automation-every-minute'
  ) THEN
    PERFORM cron.unschedule('mail-automation-every-minute');
  END IF;

  PERFORM cron.schedule(
    'mail-automation-every-minute',
    '* * * * *',
    'SELECT public.trigger_mail_process_schedules();'
  );
END $$;
