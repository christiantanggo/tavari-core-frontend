-- Per-participant venue check-in for bookings (partial arrivals, return later to finish).

ALTER TABLE public.booking_participants
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

COMMENT ON COLUMN public.booking_participants.checked_in_at IS
  'When this participant was checked in at the venue; NULL = not yet arrived.';

CREATE INDEX IF NOT EXISTS idx_booking_participants_booking_checked_in
  ON public.booking_participants (booking_id)
  WHERE checked_in_at IS NOT NULL;
