-- Manual daily labor dollars for the sales ledger (historical backfill before time clocks).
-- NULL labor_dollars = not entered (use time-clock labor when available); 0 is a valid explicit entry.

CREATE TABLE IF NOT EXISTS public.daily_sales_manual_labor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  sales_date date NOT NULL,
  labor_dollars numeric,
  notes text,
  entered_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_sales_manual_labor_business_date_unique UNIQUE (business_id, sales_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_sales_manual_labor_business_date
  ON public.daily_sales_manual_labor (business_id, sales_date DESC);

COMMENT ON TABLE public.daily_sales_manual_labor IS
  'Manager-entered daily labor for the sales ledger. NULL = not entered (fall back to time clocks); explicit values override clock labor for that day.';
COMMENT ON COLUMN public.daily_sales_manual_labor.labor_dollars IS
  'Total labor dollars for the business day. NULL means not entered yet.';

ALTER TABLE public.daily_sales_manual_labor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_sales_manual_labor_business ON public.daily_sales_manual_labor;
CREATE POLICY daily_sales_manual_labor_business ON public.daily_sales_manual_labor
  FOR ALL USING (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_sales_manual_labor TO authenticated;
