-- Manual daily cash collected (off-till / total physical cash) for the sales ledger.
-- NULL cash_collected = not entered; 0 and negative values are valid explicit entries.

CREATE TABLE IF NOT EXISTS public.daily_sales_manual_cash (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  sales_date date NOT NULL,
  cash_collected numeric,
  notes text,
  entered_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_sales_manual_cash_business_date_unique UNIQUE (business_id, sales_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_sales_manual_cash_business_date
  ON public.daily_sales_manual_cash (business_id, sales_date DESC);

COMMENT ON TABLE public.daily_sales_manual_cash IS
  'Manager-entered total physical cash collected per business day. NULL = not entered; 0 = no cash; negative allowed for net cash returns.';
COMMENT ON COLUMN public.daily_sales_manual_cash.cash_collected IS
  'Total cash collected for the day. NULL means not entered yet. Subtract Helcim/Clover system cash when computing ledger total.';

ALTER TABLE public.daily_sales_manual_cash ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_sales_manual_cash_business ON public.daily_sales_manual_cash;
CREATE POLICY daily_sales_manual_cash_business ON public.daily_sales_manual_cash
  FOR ALL USING (
    business_id IN (
      SELECT bu.business_id FROM public.business_users bu WHERE bu.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_sales_manual_cash TO authenticated;
