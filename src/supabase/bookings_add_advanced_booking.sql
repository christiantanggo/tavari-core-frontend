-- ============================================
-- ADD ADVANCED BOOKING TO BOOKING ACTIVITIES
-- ============================================
-- Min notice: "Customers must book at least X [minutes|hours|days|months] in advance"
-- Max advance: "Customers cannot book more than X [minutes|hours|days|months] in advance"
-- Value 0 = rule disabled (no restriction). Units: minutes, hours, days, months.

-- ============================================
-- ALTER TABLE: booking_activities
-- ============================================

-- Min notice (book at least X in advance)
ALTER TABLE booking_activities
  ADD COLUMN IF NOT EXISTS min_advance_booking_value INTEGER DEFAULT 0
    CHECK (min_advance_booking_value >= 0 AND min_advance_booking_value <= 60);

ALTER TABLE booking_activities
  ADD COLUMN IF NOT EXISTS min_advance_booking_unit TEXT DEFAULT 'minutes';

ALTER TABLE booking_activities
  ADD COLUMN IF NOT EXISTS max_advance_booking_value INTEGER DEFAULT 0
    CHECK (max_advance_booking_value >= 0 AND max_advance_booking_value <= 60);

ALTER TABLE booking_activities
  ADD COLUMN IF NOT EXISTS max_advance_booking_unit TEXT DEFAULT 'days';

-- Allow NULL unit when value is 0 (rule off)
COMMENT ON COLUMN booking_activities.min_advance_booking_value IS 'Min notice: book at least this many units in advance. 0 = no restriction.';
COMMENT ON COLUMN booking_activities.min_advance_booking_unit IS 'Min notice unit: minutes, hours, days, months.';
COMMENT ON COLUMN booking_activities.max_advance_booking_value IS 'Max advance: cannot book more than this many units ahead. 0 = no restriction.';
COMMENT ON COLUMN booking_activities.max_advance_booking_unit IS 'Max advance unit: minutes, hours, days, months.';
