-- Audit trail for booking changes: who, when, and what changed.

CREATE TABLE IF NOT EXISTS public.booking_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_ip text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_booking_history_booking
  ON public.booking_history (booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_history_business
  ON public.booking_history (business_id);

ALTER TABLE public.booking_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_history_select" ON public.booking_history;
DROP POLICY IF EXISTS "booking_history_insert" ON public.booking_history;

CREATE POLICY "booking_history_select"
  ON public.booking_history
  FOR SELECT
  TO authenticated
  USING (public.is_digital_signage_business_member(business_id));

CREATE POLICY "booking_history_insert"
  ON public.booking_history
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_digital_signage_business_member(business_id));

COMMENT ON TABLE public.booking_history IS 'Immutable audit log of booking changes for staff history tab.';
