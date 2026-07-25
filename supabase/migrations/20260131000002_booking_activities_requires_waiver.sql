-- Ensure requires_waiver column exists on booking_activities and booking_types
-- (safe to run if column already exists)

ALTER TABLE booking_activities
  ADD COLUMN IF NOT EXISTS requires_waiver BOOLEAN DEFAULT false;

ALTER TABLE booking_types
  ADD COLUMN IF NOT EXISTS requires_waiver BOOLEAN DEFAULT false;
