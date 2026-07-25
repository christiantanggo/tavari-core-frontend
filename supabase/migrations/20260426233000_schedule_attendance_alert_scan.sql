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
  'scheduling_attendance_scan_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (key_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.scheduling_attendance_alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES public.scheduling_shifts(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event_key text NOT NULL CHECK (event_key IN ('missed_clock_in', 'missed_break')),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'sent', 'failed')),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  response jsonb,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (shift_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_scheduling_attendance_alert_deliveries_business
  ON public.scheduling_attendance_alert_deliveries (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scheduling_attendance_alert_deliveries_employee
  ON public.scheduling_attendance_alert_deliveries (employee_id, created_at DESC);

ALTER TABLE public.scheduling_attendance_alert_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business members can view scheduling attendance alerts"
  ON public.scheduling_attendance_alert_deliveries;

CREATE POLICY "Business members can view scheduling attendance alerts"
  ON public.scheduling_attendance_alert_deliveries
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT business_users.business_id
      FROM public.business_users
      WHERE business_users.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.trigger_scheduling_attendance_alert_scan()
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
  WHERE key_name = 'scheduling_attendance_scan_secret';

  IF schedule_secret IS NULL OR schedule_secret = '' THEN
    RAISE EXCEPTION 'scheduling_attendance_scan_secret is not configured';
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/scheduling-scan-attendance-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduling-attendance-secret', schedule_secret
    ),
    body := jsonb_build_object(
      'source', 'pg_cron',
      'graceMinutes', 15,
      'breakThresholdMinutes', 360
    ),
    timeout_milliseconds := 30000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_scheduling_attendance_alert_scan() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'scheduling-attendance-alert-scan-every-5-minutes'
  ) THEN
    PERFORM cron.unschedule('scheduling-attendance-alert-scan-every-5-minutes');
  END IF;

  PERFORM cron.schedule(
    'scheduling-attendance-alert-scan-every-5-minutes',
    '*/5 * * * *',
    'SELECT public.trigger_scheduling_attendance_alert_scan();'
  );
END $$;
