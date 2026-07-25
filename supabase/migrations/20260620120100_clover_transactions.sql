-- Clover payment webhooks and sync imports (in-store POS card sales).

CREATE TABLE IF NOT EXISTS public.clover_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  payment_id TEXT NOT NULL,
  notification_key TEXT,
  event_type TEXT NOT NULL,
  event_date TIMESTAMPTZ,
  transaction_kind TEXT NOT NULL DEFAULT 'sale',
  amount NUMERIC(12, 2),
  result TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  order_id TEXT,
  employee_id TEXT,
  payment_source TEXT NOT NULL DEFAULT 'clover_pos',
  raw_webhook JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_details JSONB,
  fetched_details_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clover_transactions_notification_key
  ON public.clover_transactions (notification_key)
  WHERE notification_key IS NOT NULL AND notification_key <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_clover_transactions_business_payment_event
  ON public.clover_transactions (business_id, payment_id, event_type);

ALTER TABLE public.clover_transactions
  DROP CONSTRAINT IF EXISTS clover_transactions_business_payment_event_key;

ALTER TABLE public.clover_transactions
  ADD CONSTRAINT clover_transactions_business_payment_event_key
  UNIQUE (business_id, payment_id, event_type);

CREATE INDEX IF NOT EXISTS idx_clover_transactions_business_event_date
  ON public.clover_transactions (business_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_clover_transactions_business_created
  ON public.clover_transactions (business_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.update_clover_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clover_transactions_updated ON public.clover_transactions;
CREATE TRIGGER trg_clover_transactions_updated
  BEFORE UPDATE ON public.clover_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_clover_transactions_updated_at();

ALTER TABLE public.clover_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clover_transactions_select_business ON public.clover_transactions;
CREATE POLICY clover_transactions_select_business
  ON public.clover_transactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = clover_transactions.business_id
        AND bu.user_id = auth.uid()
    )
  );

REVOKE ALL ON public.clover_transactions FROM PUBLIC;
GRANT SELECT ON public.clover_transactions TO authenticated;
GRANT ALL ON public.clover_transactions TO service_role;

COMMENT ON TABLE public.clover_transactions IS
  'Clover payment webhooks and sync imports per business (in-store POS sales).';
