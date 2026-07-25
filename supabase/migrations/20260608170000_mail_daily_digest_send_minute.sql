-- Optional local minute for daily digest (with daily_digest_send_hour).
-- NULL = legacy: first cron tick within that hour (hour-only match).

ALTER TABLE public.mail_settings
  ADD COLUMN IF NOT EXISTS daily_digest_send_minute smallint
    CHECK (
      daily_digest_send_minute IS NULL
      OR (daily_digest_send_minute >= 0 AND daily_digest_send_minute <= 59)
    );

COMMENT ON COLUMN public.mail_settings.daily_digest_send_minute IS
  'Optional local minute (0-59) with daily_digest_send_hour. NULL = legacy: send on first cron invocation within that hour (minute not enforced).';
