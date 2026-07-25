-- Precomputed daily sales ledger rows for fast reads (avoids aggregating POS/Clover/Authorize on every page load).

CREATE TABLE IF NOT EXISTS public.daily_sales_ledger_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  sales_date date NOT NULL,
  clover numeric NOT NULL DEFAULT 0,
  helcim numeric NOT NULL DEFAULT 0,
  authorize_net numeric NOT NULL DEFAULT 0,
  manual_cash numeric,
  manual_labor numeric,
  clock_labor numeric NOT NULL DEFAULT 0,
  total_sales numeric,
  labor_dollars numeric NOT NULL DEFAULT 0,
  labor_percent numeric,
  profit_after_wages numeric,
  helcim_cash_in_system numeric NOT NULL DEFAULT 0,
  clover_cash_in_system numeric NOT NULL DEFAULT 0,
  sales_from_excel boolean NOT NULL DEFAULT false,
  labor_source text NOT NULL DEFAULT 'none',
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_sales_ledger_days_business_date_unique UNIQUE (business_id, sales_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_sales_ledger_days_business_date
  ON public.daily_sales_ledger_days (business_id, sales_date DESC);

COMMENT ON TABLE public.daily_sales_ledger_days IS
  'Cached per-day sales ledger totals. Refreshed when cash/labor is saved or channel data syncs.';

ALTER TABLE public.daily_sales_ledger_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_sales_ledger_days_business ON public.daily_sales_ledger_days;
CREATE POLICY daily_sales_ledger_days_business ON public.daily_sales_ledger_days
  FOR ALL USING (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_sales_ledger_days TO authenticated;
