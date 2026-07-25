-- Invoice Helcim pending sessions + reminder dispatch cron secret

CREATE TABLE IF NOT EXISTS public.invoice_pending_helcim (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  invoice_id UUID NOT NULL REFERENCES public.tavari_invoices(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  checkout_token TEXT,
  secret_token TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  helcim_transaction_id TEXT,
  helcim_approval_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_pending_helcim_checkout
  ON public.invoice_pending_helcim (checkout_token)
  WHERE checkout_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_pending_helcim_invoice
  ON public.invoice_pending_helcim (invoice_id, status);

ALTER TABLE public.invoice_pending_helcim ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_pending_helcim_service ON public.invoice_pending_helcim;
CREATE POLICY invoice_pending_helcim_service ON public.invoice_pending_helcim
  FOR ALL USING (public.tavari_invoice_is_business_member(business_id))
  WITH CHECK (public.tavari_invoice_is_business_member(business_id));

GRANT SELECT, INSERT, UPDATE ON public.invoice_pending_helcim TO authenticated;

-- Tracking token for email open / pay-link click (public, unguessable)
ALTER TABLE public.tavari_invoices
  ADD COLUMN IF NOT EXISTS email_tracking_token TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_tavari_invoices_email_tracking
  ON public.tavari_invoices (email_tracking_token)
  WHERE email_tracking_token IS NOT NULL;

-- Reminder cron secret
INSERT INTO public.system_runtime_secrets (key_name, secret_value)
VALUES (
  'invoice_reminder_dispatch_cron_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (key_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trigger_invoice_reminder_dispatch()
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
  WHERE key_name = 'invoice_reminder_dispatch_cron_secret';

  IF cron_secret IS NULL OR cron_secret = '' THEN
    RAISE EXCEPTION 'invoice_reminder_dispatch_cron_secret is not configured';
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/invoice-reminder-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-invoice-reminder-dispatch-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 120000
  );
END;
$$;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'tavari-invoice-reminder-dispatch-hourly';

SELECT cron.schedule(
  'tavari-invoice-reminder-dispatch-hourly',
  '15 * * * *',
  $$SELECT public.trigger_invoice_reminder_dispatch();$$
);
