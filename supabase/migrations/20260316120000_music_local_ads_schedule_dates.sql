-- Add optional schedule dates to music_local_ads so ads can run only between start_date and end_date.
-- NULL means no restriction (start_date NULL = no start limit, end_date NULL = no end limit).

ALTER TABLE public.music_local_ads
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE;

COMMENT ON COLUMN public.music_local_ads.start_date IS 'Optional: ad only plays on or after this date. NULL = no start limit.';
COMMENT ON COLUMN public.music_local_ads.end_date IS 'Optional: ad only plays on or before this date. NULL = no end limit.';
