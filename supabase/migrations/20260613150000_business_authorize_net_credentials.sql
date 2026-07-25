-- Per-business Authorize.net API credentials (encrypted at application layer).
-- Used for Bookeo / external card sales reconciliation and webhook verification.

CREATE TABLE IF NOT EXISTS public.business_authorize_net_credentials (
  business_id UUID PRIMARY KEY REFERENCES public.businesses (id) ON DELETE CASCADE,
  api_login_id TEXT NOT NULL,
  transaction_key_encrypted TEXT NOT NULL,
  transaction_key_hint TEXT,
  signature_key_encrypted TEXT,
  sandbox BOOLEAN NOT NULL DEFAULT false,
  payment_source TEXT NOT NULL DEFAULT 'bookeo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_authorize_net_credentials_updated
  ON public.business_authorize_net_credentials (updated_at DESC);

CREATE OR REPLACE FUNCTION public.update_business_authorize_net_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_authorize_net_credentials_updated ON public.business_authorize_net_credentials;
CREATE TRIGGER trg_business_authorize_net_credentials_updated
  BEFORE UPDATE ON public.business_authorize_net_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.update_business_authorize_net_credentials_updated_at();

ALTER TABLE public.business_authorize_net_credentials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.business_authorize_net_credentials FROM PUBLIC;
REVOKE ALL ON public.business_authorize_net_credentials FROM anon;
REVOKE ALL ON public.business_authorize_net_credentials FROM authenticated;
GRANT ALL ON public.business_authorize_net_credentials TO service_role;

COMMENT ON TABLE public.business_authorize_net_credentials IS
  'Authorize.net credentials per business; secrets encrypted with HELCIM_CREDENTIALS_ENCRYPTION_KEY in Edge Functions.';
