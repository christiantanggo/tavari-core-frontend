-- Authorize.net webhook transactions (Bookeo / external card sales).

CREATE TABLE IF NOT EXISTS public.authorize_net_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  trans_id TEXT NOT NULL,
  notification_id TEXT,
  event_type TEXT NOT NULL,
  event_date TIMESTAMPTZ,
  transaction_kind TEXT NOT NULL DEFAULT 'sale',
  amount NUMERIC(12, 2),
  auth_code TEXT,
  response_code INTEGER,
  merchant_reference_id TEXT,
  avs_response TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  card_last_four TEXT,
  card_type TEXT,
  customer_email TEXT,
  customer_name TEXT,
  invoice_description TEXT,
  payment_source TEXT NOT NULL DEFAULT 'bookeo',
  raw_webhook JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_details JSONB,
  fetched_details_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_authorize_net_transactions_notification_id
  ON public.authorize_net_transactions (notification_id)
  WHERE notification_id IS NOT NULL AND notification_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_authorize_net_transactions_business_trans_event
  ON public.authorize_net_transactions (business_id, trans_id, event_type);

ALTER TABLE public.authorize_net_transactions
  DROP CONSTRAINT IF EXISTS authorize_net_transactions_business_trans_event_key;

ALTER TABLE public.authorize_net_transactions
  ADD CONSTRAINT authorize_net_transactions_business_trans_event_key
  UNIQUE (business_id, trans_id, event_type);

CREATE INDEX IF NOT EXISTS idx_authorize_net_transactions_business_event_date
  ON public.authorize_net_transactions (business_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_authorize_net_transactions_business_created
  ON public.authorize_net_transactions (business_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.update_authorize_net_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_authorize_net_transactions_updated ON public.authorize_net_transactions;
CREATE TRIGGER trg_authorize_net_transactions_updated
  BEFORE UPDATE ON public.authorize_net_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_authorize_net_transactions_updated_at();

ALTER TABLE public.authorize_net_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authorize_net_transactions_select_business ON public.authorize_net_transactions;
CREATE POLICY authorize_net_transactions_select_business
  ON public.authorize_net_transactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = authorize_net_transactions.business_id
        AND bu.user_id = auth.uid()
    )
  );

REVOKE ALL ON public.authorize_net_transactions FROM PUBLIC;
GRANT SELECT ON public.authorize_net_transactions TO authenticated;
GRANT ALL ON public.authorize_net_transactions TO service_role;

COMMENT ON TABLE public.authorize_net_transactions IS
  'Authorize.net payment webhooks (e.g. Bookeo card sales) per business.';
