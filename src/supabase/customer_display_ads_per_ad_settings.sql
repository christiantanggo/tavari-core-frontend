-- Add per-ad display settings to customer_display_ads table
-- This allows each ad to have its own display settings instead of global settings

-- Add new columns for per-ad settings
ALTER TABLE customer_display_ads 
ADD COLUMN IF NOT EXISTS display_duration INTEGER DEFAULT 5,
ADD COLUMN IF NOT EXISTS auto_rotate BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS show_promo_code BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS indefinite_dates BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS schedule_days INTEGER[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS schedule_start_time TIME DEFAULT '09:00:00',
ADD COLUMN IF NOT EXISTS schedule_end_time TIME DEFAULT '17:00:00',
ADD COLUMN IF NOT EXISTS schedule_all_day BOOLEAN DEFAULT false;

-- Add comments for documentation
COMMENT ON COLUMN customer_display_ads.display_duration IS 'How long this ad displays in seconds (1-60)';
COMMENT ON COLUMN customer_display_ads.auto_rotate IS 'Whether this ad is included in automatic rotation';
COMMENT ON COLUMN customer_display_ads.show_promo_code IS 'Whether to display promo code on this ad';
COMMENT ON COLUMN customer_display_ads.indefinite_dates IS 'Whether this ad runs indefinitely without an end date';
COMMENT ON COLUMN customer_display_ads.schedule_days IS 'Array of days (0=Sunday, 1=Monday, etc.) when this ad should run';
COMMENT ON COLUMN customer_display_ads.schedule_start_time IS 'Start time for scheduled display (ignored if schedule_all_day is true)';
COMMENT ON COLUMN customer_display_ads.schedule_end_time IS 'End time for scheduled display (ignored if schedule_all_day is true)';
COMMENT ON COLUMN customer_display_ads.schedule_all_day IS 'Whether this ad runs all day on selected days';

-- Update existing records to have default values
UPDATE customer_display_ads 
SET 
  display_duration = 5,
  auto_rotate = true,
  show_promo_code = true,
  indefinite_dates = false,
  schedule_days = '{}',
  schedule_start_time = '09:00:00',
  schedule_end_time = '17:00:00',
  schedule_all_day = false
WHERE display_duration IS NULL OR auto_rotate IS NULL OR show_promo_code IS NULL;
