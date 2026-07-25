-- Persist digest attempt / failure details so silent overnight misses are diagnosable.
ALTER TABLE public.mail_settings
  ADD COLUMN IF NOT EXISTS daily_digest_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS daily_digest_last_error text;

COMMENT ON COLUMN public.mail_settings.daily_digest_last_attempt_at IS
  'When mail-daily-digest last attempted a send for this business (success or failure).';
COMMENT ON COLUMN public.mail_settings.daily_digest_last_error IS
  'Last digest failure message; cleared on successful send.';
