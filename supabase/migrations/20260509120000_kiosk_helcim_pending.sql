-- Self-serve kiosk: Helcim Pay sessions without a physical terminal (QR / phone wallet checkout).

CREATE TABLE IF NOT EXISTS public.kiosk_helcim_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_token TEXT UNIQUE,
  secret_token TEXT,
  invoice_number TEXT NOT NULL UNIQUE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  label TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  helcim_transaction_id TEXT,
  helcim_approval_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kiosk_helcim_pending_checkout_token
  ON public.kiosk_helcim_pending (checkout_token)
  WHERE checkout_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kiosk_helcim_pending_status
  ON public.kiosk_helcim_pending (business_id, status, created_at DESC);

ALTER TABLE public.kiosk_helcim_pending ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.kiosk_helcim_pending FROM PUBLIC;
REVOKE ALL ON public.kiosk_helcim_pending FROM anon;
REVOKE ALL ON public.kiosk_helcim_pending FROM authenticated;
GRANT ALL ON public.kiosk_helcim_pending TO service_role;

COMMENT ON TABLE public.kiosk_helcim_pending IS
  'Helcim Pay checkout sessions for self-serve kiosk (QR); invoice_number KK-{id}; webhook marks completed.';
