-- Optional IANA timezone for daily digest date boundaries + header text.
-- When null, mail-daily-digest uses businesses.timezone (after validation).

ALTER TABLE public.mail_settings
  ADD COLUMN IF NOT EXISTS daily_digest_timezone text;

COMMENT ON COLUMN public.mail_settings.daily_digest_timezone IS
  'Optional IANA TZ for digest stats window and email label; null uses businesses.timezone.';
