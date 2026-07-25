-- Speed up bookings dashboard date-window queries (business_id + booking_date range).
CREATE INDEX IF NOT EXISTS idx_bookings_business_booking_date
  ON public.bookings (business_id, booking_date DESC);
