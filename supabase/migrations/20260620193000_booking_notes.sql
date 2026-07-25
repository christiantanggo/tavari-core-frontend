-- Staff notes on bookings: stacked thread with author and timestamps.

CREATE TABLE IF NOT EXISTS public.booking_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  note_text text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_booking_notes_booking
  ON public.booking_notes (booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_notes_business
  ON public.booking_notes (business_id);

ALTER TABLE public.booking_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_notes_select" ON public.booking_notes;
DROP POLICY IF EXISTS "booking_notes_insert" ON public.booking_notes;
DROP POLICY IF EXISTS "booking_notes_update" ON public.booking_notes;
DROP POLICY IF EXISTS "booking_notes_delete" ON public.booking_notes;

CREATE POLICY "booking_notes_select"
  ON public.booking_notes
  FOR SELECT
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

CREATE POLICY "booking_notes_insert"
  ON public.booking_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "booking_notes_update"
  ON public.booking_notes
  FOR UPDATE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id))
  WITH CHECK (public.is_digital_signage_business_member(business_id));

CREATE POLICY "booking_notes_delete"
  ON public.booking_notes
  FOR DELETE
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

COMMENT ON TABLE public.booking_notes IS 'Staff notes on a booking; multiple users can add stacked notes.';
