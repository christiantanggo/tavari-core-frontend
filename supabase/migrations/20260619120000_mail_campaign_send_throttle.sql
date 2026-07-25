-- Gradual campaign send: per-day rate ramp + local send window (7am–7pm default).
-- Enforced in mail-process-queue; automations/rollouts/transactional are unaffected.

ALTER TABLE public.mail_campaigns
  ADD COLUMN IF NOT EXISTS send_throttle_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS send_throttle_started_on date,
  ADD COLUMN IF NOT EXISTS send_throttle_timezone text,
  ADD COLUMN IF NOT EXISTS send_throttle_window_start_hour integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS send_throttle_window_end_hour integer NOT NULL DEFAULT 19,
  ADD COLUMN IF NOT EXISTS send_throttle_initial_rate_per_minute integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS send_throttle_daily_increment integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS send_throttle_max_rate_per_minute integer NOT NULL DEFAULT 100;

ALTER TABLE public.mail_campaigns
  DROP CONSTRAINT IF EXISTS mail_campaigns_send_throttle_window_hours_check;

ALTER TABLE public.mail_campaigns
  ADD CONSTRAINT mail_campaigns_send_throttle_window_hours_check
  CHECK (
    send_throttle_window_start_hour >= 0
    AND send_throttle_window_start_hour <= 23
    AND send_throttle_window_end_hour >= 1
    AND send_throttle_window_end_hour <= 24
    AND send_throttle_window_start_hour < send_throttle_window_end_hour
  );

ALTER TABLE public.mail_campaigns
  DROP CONSTRAINT IF EXISTS mail_campaigns_send_throttle_rates_check;

ALTER TABLE public.mail_campaigns
  ADD CONSTRAINT mail_campaigns_send_throttle_rates_check
  CHECK (
    send_throttle_initial_rate_per_minute >= 1
    AND send_throttle_initial_rate_per_minute <= 500
    AND send_throttle_daily_increment >= 0
    AND send_throttle_daily_increment <= 100
    AND send_throttle_max_rate_per_minute >= 1
    AND send_throttle_max_rate_per_minute <= 500
    AND send_throttle_initial_rate_per_minute <= send_throttle_max_rate_per_minute
  );

CREATE INDEX IF NOT EXISTS idx_mail_sending_queue_campaign_sent_minute
  ON public.mail_sending_queue (campaign_id, processed_at DESC)
  WHERE status IN ('sent', 'processing');

COMMENT ON COLUMN public.mail_campaigns.send_throttle_enabled IS
  'When true, mail-process-queue caps this campaign''s marketing sends per minute (local window + daily ramp).';
