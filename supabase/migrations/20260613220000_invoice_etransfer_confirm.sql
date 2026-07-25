-- E-transfer customer notify + manager confirm tokens

ALTER TABLE public.tavari_invoices
  ADD COLUMN IF NOT EXISTS etransfer_confirm_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS etransfer_customer_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS etransfer_confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tavari_invoices_etransfer_confirm_token
  ON public.tavari_invoices (etransfer_confirm_token)
  WHERE etransfer_confirm_token IS NOT NULL;
