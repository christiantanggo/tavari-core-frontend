-- HR contract milestone emails (probation / seasonal end) — dedupe log + daily cron hook

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.system_runtime_secrets (
  key_name text PRIMARY KEY,
  secret_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.hr_contract_notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.hr_contracts(id) ON DELETE CASCADE,
  milestone_key text NOT NULL,
  target_date date NOT NULL,
  days_before integer NOT NULL,
  recipient_email text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  mail_message_id text,
  error_message text,
  CONSTRAINT hr_contract_notification_log_unique
    UNIQUE (contract_id, milestone_key, target_date)
);

CREATE INDEX IF NOT EXISTS hr_contract_notification_log_business_idx
  ON public.hr_contract_notification_log (business_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS hr_contract_notification_log_contract_idx
  ON public.hr_contract_notification_log (contract_id);

COMMENT ON TABLE public.hr_contract_notification_log IS
  'One row per contract milestone email sent (probation reminders, contract end reminder).';

ALTER TABLE public.hr_contract_notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_contract_notification_log_service_role
  ON public.hr_contract_notification_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO public.system_runtime_secrets (key_name, secret_value)
VALUES (
  'hr_contract_milestone_cron_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (key_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trigger_hr_contract_milestone_dispatch()
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
  WHERE key_name = 'hr_contract_milestone_cron_secret';

  IF cron_secret IS NULL OR cron_secret = '' THEN
    RAISE EXCEPTION 'hr_contract_milestone_cron_secret is not configured';
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/hr-contract-milestone-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hr-contract-milestone-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 120000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_hr_contract_milestone_dispatch() FROM PUBLIC;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'tavari-hr-contract-milestone-dispatch-daily';

SELECT cron.schedule(
  'tavari-hr-contract-milestone-dispatch-daily',
  '15 13 * * *',
  $$SELECT public.trigger_hr_contract_milestone_dispatch();$$
);

COMMENT ON FUNCTION public.trigger_hr_contract_milestone_dispatch IS
  'Daily (13:15 UTC) POST to hr-contract-milestone-dispatch for probation/contract-end authorized-rep emails.';
