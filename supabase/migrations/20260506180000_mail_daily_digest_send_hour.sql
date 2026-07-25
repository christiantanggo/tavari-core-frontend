-- Persist local hour for automated digest (defaults to 20 = 8 PM). Edge cron compares business-local hour only.

ALTER TABLE public.mail_settings
  ADD COLUMN IF NOT EXISTS daily_digest_send_hour smallint NOT NULL DEFAULT 20;

COMMENT ON COLUMN public.mail_settings.daily_digest_send_hour IS
  'Local hour (0–23, business timezone) when mail-daily-digest cron should send; compared on each cron tick.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mail_settings_daily_digest_send_hour_range'
  ) THEN
    ALTER TABLE public.mail_settings
      ADD CONSTRAINT mail_settings_daily_digest_send_hour_range
      CHECK (daily_digest_send_hour >= 0 AND daily_digest_send_hour <= 23);
  END IF;
END $$;
