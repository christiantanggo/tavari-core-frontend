-- Order positions for org rank (lowest number = highest rank, shown first in UI)
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

-- Backfill stable ordering per business (by name) so existing rows are ordered before manual tweaks
UPDATE public.positions p
SET display_order = s.rn
FROM (
  SELECT
    id,
    (row_number() OVER (PARTITION BY business_id ORDER BY position_name) - 1) AS rn
  FROM public.positions
) s
WHERE p.id = s.id;

CREATE INDEX IF NOT EXISTS idx_positions_business_display_order ON public.positions (business_id, display_order);

COMMENT ON COLUMN public.positions.display_order IS 'Sort rank: 0 = highest. Used for Position Management list and dropdowns.';
