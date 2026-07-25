-- Denominator for schedule ring + "blocked" count: blocked = nominal_max_spaces - spaces
-- (when capacity is reduced without new bookings, e.g. block seats in calendar).

ALTER TABLE public.booking_activity_schedules
  ADD COLUMN IF NOT EXISTS nominal_max_spaces integer;

UPDATE public.booking_activity_schedules
SET nominal_max_spaces = spaces
WHERE nominal_max_spaces IS NULL AND spaces IS NOT NULL AND spaces > 0;

COMMENT ON COLUMN public.booking_activity_schedules.nominal_max_spaces IS
  'High-water mark for this slot; UI ring uses this as total seats. Blocked = nominal_max_spaces - spaces.';

ALTER TABLE public.booking_activity_schedules
  DROP CONSTRAINT IF EXISTS booking_activity_schedules_nominal_ge_spaces;

ALTER TABLE public.booking_activity_schedules
  ADD CONSTRAINT booking_activity_schedules_nominal_ge_spaces
  CHECK (nominal_max_spaces IS NULL OR nominal_max_spaces >= spaces);
