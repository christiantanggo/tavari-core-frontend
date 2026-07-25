-- Per-business Clover API credentials (encrypted at application layer).

CREATE TABLE IF NOT EXISTS public.business_clover_credentials (
  business_id UUID PRIMARY KEY REFERENCES public.businesses (id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL,
  api_token_encrypted TEXT NOT NULL,
  api_token_hint TEXT,
  clover_auth_code_encrypted TEXT,
  sandbox BOOLEAN NOT NULL DEFAULT true,
  payment_source TEXT NOT NULL DEFAULT 'clover_pos',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_clover_credentials_updated
  ON public.business_clover_credentials (updated_at DESC);

CREATE OR REPLACE FUNCTION public.update_business_clover_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_clover_credentials_updated ON public.business_clover_credentials;
CREATE TRIGGER trg_business_clover_credentials_updated
  BEFORE UPDATE ON public.business_clover_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.update_business_clover_credentials_updated_at();

ALTER TABLE public.business_clover_credentials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.business_clover_credentials FROM PUBLIC;
REVOKE ALL ON public.business_clover_credentials FROM anon;
REVOKE ALL ON public.business_clover_credentials FROM authenticated;
GRANT ALL ON public.business_clover_credentials TO service_role;

COMMENT ON TABLE public.business_clover_credentials IS
  'Clover REST credentials per business; API token encrypted with HELCIM_CREDENTIALS_ENCRYPTION_KEY in Edge Functions.';
