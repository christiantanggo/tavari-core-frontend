-- Run the mail automation processor every minute from Supabase itself.
-- This picks up due scheduled campaigns and drains the send queue without a browser session.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  project_url TEXT := COALESCE(
    NULLIF(current_setting('app.settings.supabase_url', true), ''),
    'https://iagcamwcfuiopmwefohz.supabase.co'
  );
  request_url TEXT;
BEGIN
  request_url := project_url || '/functions/v1/mail-process-schedules';

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
    format(
      $job$
      SELECT net.http_post(
        url := %L,
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{"batchSize":100}'::jsonb
      );
      $job$,
      request_url
    )
  );
END $$;
