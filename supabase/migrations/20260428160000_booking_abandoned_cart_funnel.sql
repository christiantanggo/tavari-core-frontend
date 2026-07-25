-- Abandoned booking cart: funnel tracking + columns on pending Helcim + pg_cron to process emails

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Ensure runtime secrets table exists (may already exist from other modules)
CREATE TABLE IF NOT EXISTS public.system_runtime_secrets (
  key_name text PRIMARY KEY,
  secret_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

INSERT INTO public.system_runtime_secrets (key_name, secret_value)
VALUES (
  'booking_abandoned_cart_cron_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (key_name) DO NOTHING;

-- Pending Helcim: who to email + dedupe
ALTER TABLE public.booking_pending_helcim
  ADD COLUMN IF NOT EXISTS abandoned_cart_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_email_snapshot text;

COMMENT ON COLUMN public.booking_pending_helcim.abandoned_cart_email_sent_at IS 'Set when process-booking-abandoned-carts sends nudge email.';
COMMENT ON COLUMN public.booking_pending_helcim.customer_email_snapshot IS 'Copy of customer email at checkout init for abandoned emails.';

CREATE INDEX IF NOT EXISTS idx_booking_pending_helcim_abandoned
  ON public.booking_pending_helcim (business_id, status, created_at)
  WHERE status = 'pending' AND abandoned_cart_email_sent_at IS NULL;

-- Funnel: pre-payment and linked checkout (session is per business+activity in browser)
CREATE TABLE IF NOT EXISTS public.booking_portal_funnel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES public.booking_activities(id) ON DELETE CASCADE,
  client_session_key text NOT NULL,
  customer_id uuid REFERENCES public.pos_loyalty_accounts(id) ON DELETE SET NULL,
  customer_email text,
  current_stage text NOT NULL DEFAULT 'activity_view' CHECK (current_stage IN (
    'activity_view', 'date_time', 'participants', 'tickets', 'payment', 'payment_started', 'converted'
  )),
  pending_helcim_id uuid REFERENCES public.booking_pending_helcim(id) ON DELETE SET NULL,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  abandoned_email_sent_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT booking_portal_funnel_session_unique UNIQUE (business_id, activity_id, client_session_key)
);

CREATE INDEX IF NOT EXISTS idx_booking_portal_funnel_abandoned
  ON public.booking_portal_funnel (business_id, last_activity_at)
  WHERE abandoned_email_sent_at IS NULL AND current_stage <> 'converted';

ALTER TABLE public.booking_portal_funnel ENABLE ROW LEVEL SECURITY;

-- Service role only (edge functions)
DROP POLICY IF EXISTS "Service role full access booking_portal_funnel" ON public.booking_portal_funnel;
CREATE POLICY "Service role full access booking_portal_funnel"
  ON public.booking_portal_funnel FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.booking_portal_funnel IS 'Customer portal booking funnel; used for abandoned-cart nudges.';

-- Cron: call edge function every 15 minutes
CREATE OR REPLACE FUNCTION public.trigger_booking_abandoned_cart_process()
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
  WHERE key_name = 'booking_abandoned_cart_cron_secret';

  IF schedule_secret IS NULL OR schedule_secret = '' THEN
    RAISE EXCEPTION 'booking_abandoned_cart_cron_secret is not configured';
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/process-booking-abandoned-carts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-booking-abandoned-secret', schedule_secret
    )::jsonb,
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 120000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_booking_abandoned_cart_process() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'booking-abandoned-cart-every-15-minutes') THEN
    PERFORM cron.unschedule('booking-abandoned-cart-every-15-minutes');
  END IF;
  PERFORM cron.schedule(
    'booking-abandoned-cart-every-15-minutes',
    '*/15 * * * *',
    'SELECT public.trigger_booking_abandoned_cart_process();'
  );
END $$;
