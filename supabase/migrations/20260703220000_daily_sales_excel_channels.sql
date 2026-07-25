-- Historical Clover + Authorize.net daily totals imported from Excel tracker.
-- Used when API-synced transactions are unavailable for older dates.
-- Excel Clover column may include Helcim sales lumped in for that era.

CREATE TABLE IF NOT EXISTS public.daily_sales_excel_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  sales_date date NOT NULL,
  clover numeric,
  authorize_net numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_sales_excel_channels_business_date_unique UNIQUE (business_id, sales_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_sales_excel_channels_business_date
  ON public.daily_sales_excel_channels (business_id, sales_date DESC);

COMMENT ON TABLE public.daily_sales_excel_channels IS
  'Excel-imported daily Clover and Authorize.net totals for dates before API sync coverage.';

ALTER TABLE public.daily_sales_excel_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_sales_excel_channels_business ON public.daily_sales_excel_channels;
CREATE POLICY daily_sales_excel_channels_business ON public.daily_sales_excel_channels
  FOR ALL USING (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_sales_excel_channels TO authenticated;
