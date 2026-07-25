-- Recurring invoice templates (monthly subscriptions / auto-reissue)

CREATE TABLE IF NOT EXISTS public.tavari_recurring_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'ended')),
  frequency TEXT NOT NULL DEFAULT 'monthly'
    CHECK (frequency IN ('monthly')),
  schedule_day_of_month INT NOT NULL DEFAULT 1
    CHECK (schedule_day_of_month >= 1 AND schedule_day_of_month <= 28),
  starts_on DATE NOT NULL,
  ends_on DATE,
  max_occurrences INT CHECK (max_occurrences IS NULL OR max_occurrences > 0),
  occurrences_sent INT NOT NULL DEFAULT 0,
  next_run_date DATE NOT NULL,
  auto_send BOOLEAN NOT NULL DEFAULT true,
  due_days_override INT CHECK (due_days_override IS NULL OR due_days_override >= 0),
  recipient_type TEXT NOT NULL DEFAULT 'customer'
    CHECK (recipient_type IN ('customer', 'business')),
  loyalty_customer_id UUID REFERENCES public.pos_loyalty_accounts(id) ON DELETE SET NULL,
  recipient_name TEXT NOT NULL,
  recipient_email TEXT,
  recipient_phone TEXT,
  recipient_company TEXT,
  recipient_address TEXT,
  recipient_city TEXT,
  recipient_state TEXT,
  recipient_postal TEXT,
  display_legal_name TEXT,
  display_dba TEXT,
  display_address TEXT,
  display_city TEXT,
  display_state TEXT,
  display_postal TEXT,
  display_tax_number TEXT,
  logo_url TEXT,
  notes TEXT,
  footer_terms TEXT,
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  indian_status_gst_only BOOLEAN NOT NULL DEFAULT false,
  indian_status_certificate_number TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tavari_recurring_invoices_business_status
  ON public.tavari_recurring_invoices (business_id, status, next_run_date);

CREATE TABLE IF NOT EXISTS public.tavari_recurring_invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_template_id UUID NOT NULL REFERENCES public.tavari_recurring_invoices(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL DEFAULT 'custom'
    CHECK (line_type IN ('custom', 'inventory', 'bundle')),
  inventory_id UUID REFERENCES public.pos_inventory(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC(12, 3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax_exempt BOOLEAN NOT NULL DEFAULT false,
  tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tavari_recurring_invoice_line_items_template
  ON public.tavari_recurring_invoice_line_items (recurring_template_id, sort_order);

CREATE TABLE IF NOT EXISTS public.tavari_recurring_invoice_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_template_id UUID NOT NULL REFERENCES public.tavari_recurring_invoices(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  planned_date DATE NOT NULL,
  invoice_id UUID REFERENCES public.tavari_invoices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recurring_template_id, planned_date)
);

CREATE INDEX IF NOT EXISTS idx_tavari_recurring_invoice_runs_template
  ON public.tavari_recurring_invoice_runs (recurring_template_id, created_at DESC);

ALTER TABLE public.tavari_invoices
  ADD COLUMN IF NOT EXISTS recurring_template_id UUID
    REFERENCES public.tavari_recurring_invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tavari_invoices_recurring_template
  ON public.tavari_invoices (recurring_template_id)
  WHERE recurring_template_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_tavari_recurring_invoices_updated_at ON public.tavari_recurring_invoices;
CREATE TRIGGER trg_tavari_recurring_invoices_updated_at
  BEFORE UPDATE ON public.tavari_recurring_invoices
  FOR EACH ROW EXECUTE FUNCTION public.tavari_invoice_touch_updated_at();

ALTER TABLE public.tavari_recurring_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tavari_recurring_invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tavari_recurring_invoice_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tavari_recurring_invoices_all ON public.tavari_recurring_invoices;
CREATE POLICY tavari_recurring_invoices_all ON public.tavari_recurring_invoices
  FOR ALL USING (public.tavari_invoice_is_business_member(business_id))
  WITH CHECK (public.tavari_invoice_is_business_member(business_id));

DROP POLICY IF EXISTS tavari_recurring_invoice_line_items_all ON public.tavari_recurring_invoice_line_items;
CREATE POLICY tavari_recurring_invoice_line_items_all ON public.tavari_recurring_invoice_line_items
  FOR ALL USING (public.tavari_invoice_is_business_member(business_id))
  WITH CHECK (public.tavari_invoice_is_business_member(business_id));

DROP POLICY IF EXISTS tavari_recurring_invoice_runs_select ON public.tavari_recurring_invoice_runs;
CREATE POLICY tavari_recurring_invoice_runs_select ON public.tavari_recurring_invoice_runs
  FOR SELECT USING (public.tavari_invoice_is_business_member(business_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tavari_recurring_invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tavari_recurring_invoice_line_items TO authenticated;
GRANT SELECT ON public.tavari_recurring_invoice_runs TO authenticated;

-- Daily recurring invoice dispatch cron
INSERT INTO public.system_runtime_secrets (key_name, secret_value)
VALUES (
  'invoice_recurring_dispatch_cron_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (key_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trigger_invoice_recurring_dispatch()
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
  WHERE key_name = 'invoice_recurring_dispatch_cron_secret';

  IF cron_secret IS NULL OR cron_secret = '' THEN
    RAISE EXCEPTION 'invoice_recurring_dispatch_cron_secret is not configured';
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/invoice-recurring-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-invoice-recurring-dispatch-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 300000
  );
END;
$$;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'tavari-invoice-recurring-dispatch-daily';

SELECT cron.schedule(
  'tavari-invoice-recurring-dispatch-daily',
  '0 7 * * *',
  $$SELECT public.trigger_invoice_recurring_dispatch();$$
);
