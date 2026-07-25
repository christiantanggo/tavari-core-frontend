-- Clover App Market waiver app: separate OAuth tokens from POS payment sync app.
-- Links Clover merchantId → Tavari business_id (same waiver DB as main Tavari app).

CREATE TABLE IF NOT EXISTS public.business_clover_waiver_credentials (
  business_id UUID PRIMARY KEY REFERENCES public.businesses (id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL,
  oauth_access_token_encrypted TEXT,
  oauth_refresh_token_encrypted TEXT,
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  api_token_hint TEXT,
  sandbox BOOLEAN NOT NULL DEFAULT false,
  subscription_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (subscription_status IN ('pending', 'active', 'cancelled', 'past_due')),
  clover_billing_reference TEXT,
  clover_employee_id_last_launch TEXT,
  owner_email TEXT,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT business_clover_waiver_credentials_merchant_id_key UNIQUE (merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_business_clover_waiver_credentials_merchant
  ON public.business_clover_waiver_credentials (merchant_id);

CREATE INDEX IF NOT EXISTS idx_business_clover_waiver_credentials_subscription
  ON public.business_clover_waiver_credentials (subscription_status);

CREATE OR REPLACE FUNCTION public.update_business_clover_waiver_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_clover_waiver_credentials_updated
  ON public.business_clover_waiver_credentials;
CREATE TRIGGER trg_business_clover_waiver_credentials_updated
  BEFORE UPDATE ON public.business_clover_waiver_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.update_business_clover_waiver_credentials_updated_at();

ALTER TABLE public.business_clover_waiver_credentials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.business_clover_waiver_credentials FROM PUBLIC;
REVOKE ALL ON public.business_clover_waiver_credentials FROM anon;
REVOKE ALL ON public.business_clover_waiver_credentials FROM authenticated;
GRANT ALL ON public.business_clover_waiver_credentials TO service_role;

COMMENT ON TABLE public.business_clover_waiver_credentials IS
  'Clover App Market Tavari Waivers app OAuth per merchant; separate from business_clover_credentials (POS sync).';
