-- Allow custom ordering of booking categories (types) on settings + customer portal.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'booking_types'
      AND column_name = 'display_order'
  ) THEN
    ALTER TABLE public.booking_types
      ADD COLUMN display_order INTEGER DEFAULT 0;

    CREATE INDEX IF NOT EXISTS idx_booking_types_business_order
      ON public.booking_types (business_id, display_order)
      WHERE is_active = true;

    WITH ordered_types AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY business_id
          ORDER BY type_name ASC NULLS LAST, created_at ASC NULLS LAST
        ) - 1 AS new_order
      FROM public.booking_types
    )
    UPDATE public.booking_types bt
    SET display_order = ot.new_order
    FROM ordered_types ot
    WHERE bt.id = ot.id;
  END IF;
END $$;

COMMENT ON COLUMN public.booking_types.display_order IS
  'Order in which booking categories are shown on the customer portal (0-based)';
