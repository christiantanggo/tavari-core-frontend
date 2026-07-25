-- Escalation tracking for certificate-triggered shift premium approvals (manager chain → all managers).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.hrpayroll_employee_premiums
  ADD COLUMN IF NOT EXISTS approval_chain_step INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approval_escalation_mode TEXT NOT NULL DEFAULT 'chain'
    CHECK (approval_escalation_mode IN ('chain', 'all_managers')),
  ADD COLUMN IF NOT EXISTS approval_last_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.hrpayroll_employee_premiums.approval_chain_step IS
  'Index into users.manager_id chain; 0 = direct manager was last notified.';
COMMENT ON COLUMN public.hrpayroll_employee_premiums.approval_escalation_mode IS
  'chain = still walking manager chain; all_managers = escalated to every business manager.';
COMMENT ON COLUMN public.hrpayroll_employee_premiums.approval_last_notified_at IS
  'When the current approval step was last emailed; used for 48h escalation.';

UPDATE public.hrpayroll_employee_premiums
SET approval_last_notified_at = COALESCE(approval_last_notified_at, created_at, now())
WHERE approval_status = 'pending'
  AND approval_last_notified_at IS NULL;

INSERT INTO public.system_runtime_secrets (key_name, secret_value)
VALUES (
  'shift_premium_approval_escalate_cron_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (key_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trigger_shift_premium_approval_escalate()
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
  WHERE key_name = 'shift_premium_approval_escalate_cron_secret';

  IF cron_secret IS NULL OR cron_secret = '' THEN
    RAISE EXCEPTION 'shift_premium_approval_escalate_cron_secret is not configured';
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/shift-premium-approval-escalate',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-shift-premium-approval-escalate-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 120000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_shift_premium_approval_escalate() FROM PUBLIC;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'tavari-shift-premium-approval-escalate';

SELECT cron.schedule(
  'tavari-shift-premium-approval-escalate',
  '25 * * * *',
  $$SELECT public.trigger_shift_premium_approval_escalate();$$
);

COMMENT ON FUNCTION public.trigger_shift_premium_approval_escalate IS
  'Hourly POST to shift-premium-approval-escalate for pending certificate premium approvals.';
