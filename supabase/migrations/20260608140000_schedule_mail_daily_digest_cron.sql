-- Invoke mail-daily-digest every 15 minutes so one tick lands in each business's chosen local hour.
-- Without this, enabling the digest in UI does nothing — nothing was calling the edge function.
-- Auth: x-mail-digest-cron-secret matches system_runtime_secrets.mail_digest_cron_secret (see edge function).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

INSERT INTO public.system_runtime_secrets (key_name, secret_value)
VALUES (
  'mail_digest_cron_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (key_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trigger_mail_daily_digest_dispatch()
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
  WHERE key_name = 'mail_digest_cron_secret';

  IF cron_secret IS NULL OR cron_secret = '' THEN
    RAISE EXCEPTION 'mail_digest_cron_secret is not configured';
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/mail-daily-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mail-digest-cron-secret', cron_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_mail_daily_digest_dispatch() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'mail-daily-digest-every-15-minutes'
  ) THEN
    PERFORM cron.unschedule('mail-daily-digest-every-15-minutes');
  END IF;

  PERFORM cron.schedule(
    'mail-daily-digest-every-15-minutes',
    '*/15 * * * *',
    'SELECT public.trigger_mail_daily_digest_dispatch();'
  );
END $$;

COMMENT ON FUNCTION public.trigger_mail_daily_digest_dispatch IS
  'Called by pg_cron every 15 minutes; POSTs mail-daily-digest so local-hour digest windows are hit.';
