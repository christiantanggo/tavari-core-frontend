-- Idempotent upserts for wallkids (and other) imports: same legacy id can exist per source_system.
ALTER TABLE public.legacy_waivers
  DROP CONSTRAINT IF EXISTS legacy_waivers_business_legacy_id_unique;

ALTER TABLE public.legacy_waivers
  ADD CONSTRAINT legacy_waivers_business_source_legacy_unique
  UNIQUE (business_id, source_system, legacy_row_id);

COMMENT ON CONSTRAINT legacy_waivers_business_source_legacy_unique ON public.legacy_waivers IS
  'One row per (business, source, original primary key) for re-imports.';
