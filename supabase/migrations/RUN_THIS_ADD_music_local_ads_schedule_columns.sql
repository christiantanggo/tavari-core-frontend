-- Run this in Supabase Dashboard → SQL Editor if you get "Could not find end_date column".
-- Adds start_date and end_date to music_local_ads for ad scheduling.

ALTER TABLE public.music_local_ads
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE;

COMMENT ON COLUMN public.music_local_ads.start_date IS 'Optional: ad only plays on or after this date. NULL = no start limit.';
COMMENT ON COLUMN public.music_local_ads.end_date IS 'Optional: ad only plays on or before this date. NULL = no end limit.';
