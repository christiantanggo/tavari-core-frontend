-- Run this in Supabase Dashboard → SQL Editor if ad_selection_mode or ads_per_slot are missing.
-- Adds: Ad selection (random vs round-robin) and Ads per slot (how many ads play back-to-back).

ALTER TABLE public.music_settings
  ADD COLUMN IF NOT EXISTS ad_selection_mode TEXT DEFAULT 'random',
  ADD COLUMN IF NOT EXISTS ads_per_slot INTEGER DEFAULT 1;

COMMENT ON COLUMN public.music_settings.ad_selection_mode IS 'How to pick local ads: random or round_robin (cycle in order).';
COMMENT ON COLUMN public.music_settings.ads_per_slot IS 'Number of ads to play in a row before the next song (1-10).';
