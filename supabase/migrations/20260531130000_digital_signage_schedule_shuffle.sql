-- Shuffle playback order for schedule playlists (content pool stays the same; order is random on the player).
ALTER TABLE public.digital_signage_schedules
  ADD COLUMN IF NOT EXISTS shuffle_playlist boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.digital_signage_schedules.shuffle_playlist IS
  'When true, assigned playlist items play in random order on signage screens instead of display_order.';
