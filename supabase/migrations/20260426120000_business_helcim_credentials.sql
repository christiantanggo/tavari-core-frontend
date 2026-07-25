-- Per-business Helcim API token + webhook signing secret (encrypted at application layer).
-- Only service_role / Edge Functions read ciphertext; dashboard users use edge function + JWT.

CREATE TABLE IF NOT EXISTS public.business_helcim_credentials (
  business_id UUID PRIMARY KEY REFERENCES public.businesses (id) ON DELETE CASCADE,
  api_token_encrypted TEXT NOT NULL,
  api_token_hint TEXT,
  webhook_verifier_encrypted TEXT,
  helcim_account_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_helcim_credentials_updated
  ON public.business_helcim_credentials (updated_at DESC);

CREATE OR REPLACE FUNCTION public.update_business_helcim_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_helcim_credentials_updated ON public.business_helcim_credentials;
CREATE TRIGGER trg_business_helcim_credentials_updated
  BEFORE UPDATE ON public.business_helcim_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.update_business_helcim_credentials_updated_at();

ALTER TABLE public.business_helcim_credentials ENABLE ROW LEVEL SECURITY;

-- No policies: JWT roles cannot read/write; service_role bypasses RLS for Edge Functions.

REVOKE ALL ON public.business_helcim_credentials FROM PUBLIC;
REVOKE ALL ON public.business_helcim_credentials FROM anon;
REVOKE ALL ON public.business_helcim_credentials FROM authenticated;
GRANT ALL ON public.business_helcim_credentials TO service_role;

COMMENT ON TABLE public.business_helcim_credentials IS
  'Helcim credentials per business; ciphertext encrypted with HELCIM_CREDENTIALS_ENCRYPTION_KEY in Edge Functions.';
