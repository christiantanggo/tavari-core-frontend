ALTER TABLE public.mail_campaign_sends
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now());

COMMENT ON COLUMN public.mail_campaign_sends.updated_at IS
  'Timestamp maintained by update triggers. Required for open/click tracking updates.';
