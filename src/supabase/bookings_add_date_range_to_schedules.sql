-- ============================================
-- ADD DATE RANGE TO BOOKING ACTIVITY SCHEDULES
-- ============================================
-- Migration to add start_date and end_date columns
-- to the existing booking_activity_schedules table
-- This allows schedules to be active only within specific date ranges

-- ============================================
-- ADD COLUMNS
-- ============================================
-- Add start_date column (optional - NULL means always active)
ALTER TABLE booking_activity_schedules
  ADD COLUMN IF NOT EXISTS start_date DATE;

-- Add end_date column (optional - NULL means always active)
ALTER TABLE booking_activity_schedules
  ADD COLUMN IF NOT EXISTS end_date DATE;

-- ============================================
-- ADD CONSTRAINT
-- ============================================
-- Drop existing constraint if it exists (for idempotency)
ALTER TABLE booking_activity_schedules 
  DROP CONSTRAINT IF EXISTS check_schedule_date_range;

-- Add constraint to validate date range when both dates are provided
ALTER TABLE booking_activity_schedules
  ADD CONSTRAINT check_schedule_date_range CHECK (
    start_date IS NULL OR 
    end_date IS NULL OR 
    end_date >= start_date
  );

-- ============================================
-- INDEXES
-- ============================================
-- Index for date range queries (finding active schedules for a specific date)
CREATE INDEX IF NOT EXISTS idx_booking_activity_schedules_date_range 
  ON booking_activity_schedules(activity_id, start_date, end_date, is_active) 
  WHERE is_active = true;

-- Index for start date filtering
CREATE INDEX IF NOT EXISTS idx_booking_activity_schedules_start_date 
  ON booking_activity_schedules(start_date, is_active) 
  WHERE start_date IS NOT NULL AND is_active = true;

-- Index for end date filtering
CREATE INDEX IF NOT EXISTS idx_booking_activity_schedules_end_date 
  ON booking_activity_schedules(end_date, is_active) 
  WHERE end_date IS NOT NULL AND is_active = true;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON COLUMN booking_activity_schedules.start_date IS 'Optional start date when this schedule becomes active. NULL means always active from the beginning.';
COMMENT ON COLUMN booking_activity_schedules.end_date IS 'Optional end date when this schedule expires. NULL means always active.';
COMMENT ON CONSTRAINT check_schedule_date_range ON booking_activity_schedules IS 'Ensures end_date is not before start_date when both are provided';
