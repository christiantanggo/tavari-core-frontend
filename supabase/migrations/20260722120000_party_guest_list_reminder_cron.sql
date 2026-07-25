-- Schedule party guest list reminder dispatch (host reminders + staff incomplete alerts)

INSERT INTO public.system_runtime_secrets (key_name, secret_value)
VALUES (
  'reminder_dispatch_cron_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (key_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trigger_party_guest_list_reminder_dispatch()
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
  SELECT secret_value INTO cron_secret
  FROM public.system_runtime_secrets
  WHERE key_name = 'reminder_dispatch_cron_secret';

  IF cron_secret IS NULL OR cron_secret = '' THEN
    RAISE EXCEPTION 'reminder_dispatch_cron_secret is not configured';
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/party-guest-list-reminder-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-dispatch-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 120000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_party_guest_list_reminder_dispatch() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'party-guest-list-reminder-dispatch-daily'
  ) THEN
    PERFORM cron.unschedule('party-guest-list-reminder-dispatch-daily');
  END IF;

  PERFORM cron.schedule(
    'party-guest-list-reminder-dispatch-daily',
    '0 14 * * *',
    'SELECT public.trigger_party_guest_list_reminder_dispatch();'
  );
END $$;

COMMENT ON FUNCTION public.trigger_party_guest_list_reminder_dispatch IS
  'Daily pg_cron job invoking party-guest-list-reminder-dispatch for host/staff guest list reminders.';
