-- pg_cron → scheduling-dispatch-shift-reminders (same pattern as attendance alerts / abandoned cart).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.system_runtime_secrets (
  key_name text PRIMARY KEY,
  secret_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

INSERT INTO public.system_runtime_secrets (key_name, secret_value)
VALUES (
  'scheduling_shift_reminder_cron_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (key_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trigger_scheduling_shift_reminder_dispatch()
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
  cron_secret text;
BEGIN
  SELECT secret_value
  INTO cron_secret
  FROM public.system_runtime_secrets
  WHERE key_name = 'scheduling_shift_reminder_cron_secret';

  IF cron_secret IS NULL OR cron_secret = '' THEN
    RAISE EXCEPTION 'scheduling_shift_reminder_cron_secret is not configured';
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/scheduling-dispatch-shift-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-shift-reminder-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 120000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_scheduling_shift_reminder_dispatch() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'scheduling-shift-reminder-dispatch-every-15-minutes'
  ) THEN
    PERFORM cron.unschedule('scheduling-shift-reminder-dispatch-every-15-minutes');
  END IF;

  PERFORM cron.schedule(
    'scheduling-shift-reminder-dispatch-every-15-minutes',
    '*/15 * * * *',
    'SELECT public.trigger_scheduling_shift_reminder_dispatch();'
  );
END $$;

COMMENT ON FUNCTION public.trigger_scheduling_shift_reminder_dispatch IS
  'Called by pg_cron every 15 minutes; invokes scheduling-dispatch-shift-reminders with shared cron secret.';
