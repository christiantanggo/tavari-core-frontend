-- Store Bookeo / external booking IDs for imports and deduplication.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS external_reference TEXT;

COMMENT ON COLUMN public.bookings.external_reference IS
  'External system booking ID (e.g. Bookeo booking number). Used for imports and cross-reference.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_business_external_reference
  ON public.bookings (business_id, external_reference)
  WHERE external_reference IS NOT NULL AND external_reference <> '';
