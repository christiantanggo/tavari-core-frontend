-- Allow spaces = 0 for admin-blocked time slots: row stays active and visible on the
-- schedule while offering no bookable capacity (replaces is_active = false for this case).

ALTER TABLE public.booking_activity_schedules
  DROP CONSTRAINT IF EXISTS booking_activity_schedules_spaces_check;

ALTER TABLE public.booking_activity_schedules
  ADD CONSTRAINT booking_activity_schedules_spaces_check
  CHECK (spaces >= 0);

COMMENT ON COLUMN public.booking_activity_schedules.spaces IS
  'Concurrent bookings allowed for this slot. Use 0 when the slot is blocked but should still appear on the schedule.';
