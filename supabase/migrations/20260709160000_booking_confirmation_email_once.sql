-- Prevent duplicate booking confirmation emails when finalize + webhook + success page race.
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_notifications_confirmation_once
  ON public.booking_notifications (booking_id)
  WHERE notification_type = 'confirmation'
    AND status IN ('scheduled', 'sent');

COMMENT ON INDEX public.idx_booking_notifications_confirmation_once IS
  'Ensures at most one in-flight or completed confirmation email per booking.';
