-- OAuth access/refresh tokens for production Clover merchants (v2 OAuth flow).

ALTER TABLE public.business_clover_credentials
  ALTER COLUMN api_token_encrypted DROP NOT NULL;

ALTER TABLE public.business_clover_credentials
  ADD COLUMN IF NOT EXISTS oauth_access_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS oauth_refresh_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pending_webhook_verification_code TEXT;

COMMENT ON COLUMN public.business_clover_credentials.oauth_access_token_encrypted IS
  'Clover v2 OAuth access token (production); refreshed automatically when near expiry.';
