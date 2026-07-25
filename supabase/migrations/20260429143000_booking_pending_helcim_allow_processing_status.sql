-- finalizePendingBooking() claims a row with status = 'processing' before inserting the booking.
-- Original CHECK omitted 'processing', so the UPDATE failed and payments completed in Helcim without a Tavari booking.

ALTER TABLE public.booking_pending_helcim
  DROP CONSTRAINT IF EXISTS booking_pending_helcim_status_check;

ALTER TABLE public.booking_pending_helcim
  ADD CONSTRAINT booking_pending_helcim_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired'));
