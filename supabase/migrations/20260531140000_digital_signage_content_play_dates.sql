-- Optional play window for content (applies on all screens/schedules that include this item).
ALTER TABLE public.digital_signage_content
  ADD COLUMN IF NOT EXISTS play_start_date date,
  ADD COLUMN IF NOT EXISTS play_end_date date;

COMMENT ON COLUMN public.digital_signage_content.play_start_date IS
  'First calendar day this content may play (business timezone on player). NULL = no start limit.';

COMMENT ON COLUMN public.digital_signage_content.play_end_date IS
  'Last calendar day this content may play. NULL = indefinite (no end date).';
