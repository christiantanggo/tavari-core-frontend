-- OTWK London: enable website reputation feed via tavari-api-reputation-feed.
-- Run after migration 20260704210000_reputation_website_feed_api.sql

UPDATE public.reputation_settings
SET
  website_public_feed_enabled = true,
  website_public_feed_min_rating = 4,
  website_public_feed_limit = 9,
  updated_at = now()
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

INSERT INTO public.reputation_settings (
  business_id,
  enabled,
  website_public_feed_enabled,
  website_public_feed_min_rating,
  website_public_feed_limit
)
SELECT
  'cb982fca-cf7a-4f59-b9c7-55ca0364eddc',
  true,
  true,
  4,
  9
WHERE NOT EXISTS (
  SELECT 1 FROM public.reputation_settings
  WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc'
);
