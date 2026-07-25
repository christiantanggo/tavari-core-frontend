-- Live campaign warmup defaults (editable in Mail → Automations → Campaign warmup).
-- Active gradual sends read these from mail_settings; campaign keeps started_on + enabled only.

ALTER TABLE public.mail_settings
  ADD COLUMN IF NOT EXISTS campaign_throttle_window_start_hour integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS campaign_throttle_window_end_hour integer NOT NULL DEFAULT 19,
  ADD COLUMN IF NOT EXISTS campaign_throttle_initial_rate_per_minute integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS campaign_throttle_daily_increment integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS campaign_throttle_max_rate_per_minute integer NOT NULL DEFAULT 100;

ALTER TABLE public.mail_settings
  DROP CONSTRAINT IF EXISTS mail_settings_campaign_throttle_window_hours_check;

ALTER TABLE public.mail_settings
  ADD CONSTRAINT mail_settings_campaign_throttle_window_hours_check
  CHECK (
    campaign_throttle_window_start_hour >= 0
    AND campaign_throttle_window_start_hour <= 23
    AND campaign_throttle_window_end_hour >= 1
    AND campaign_throttle_window_end_hour <= 24
    AND campaign_throttle_window_start_hour < campaign_throttle_window_end_hour
  );

ALTER TABLE public.mail_settings
  DROP CONSTRAINT IF EXISTS mail_settings_campaign_throttle_rates_check;

ALTER TABLE public.mail_settings
  ADD CONSTRAINT mail_settings_campaign_throttle_rates_check
  CHECK (
    campaign_throttle_initial_rate_per_minute >= 1
    AND campaign_throttle_initial_rate_per_minute <= 500
    AND campaign_throttle_daily_increment >= 0
    AND campaign_throttle_daily_increment <= 100
    AND campaign_throttle_max_rate_per_minute >= 1
    AND campaign_throttle_max_rate_per_minute <= 500
    AND campaign_throttle_initial_rate_per_minute <= campaign_throttle_max_rate_per_minute
  );

COMMENT ON COLUMN public.mail_settings.campaign_throttle_initial_rate_per_minute IS
  'Gradual mass-campaign send: starting emails per minute (day 1). Applied to active throttled campaigns immediately when changed.';
