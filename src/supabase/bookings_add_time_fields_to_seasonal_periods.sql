-- ============================================
-- ADD TIME FIELDS TO BOOKING SEASONAL PERIODS
-- ============================================
-- Migration to add start_time, end_time, and is_full_day columns
-- to the existing booking_seasonal_periods table

-- ============================================
-- ADD COLUMNS
-- ============================================
-- Add start_time column
ALTER TABLE booking_seasonal_periods
  ADD COLUMN IF NOT EXISTS start_time TIME;

-- Add end_time column
ALTER TABLE booking_seasonal_periods
  ADD COLUMN IF NOT EXISTS end_time TIME;

-- Add is_full_day column
ALTER TABLE booking_seasonal_periods
  ADD COLUMN IF NOT EXISTS is_full_day BOOLEAN DEFAULT true;

-- ============================================
-- UPDATE EXISTING ROWS
-- ============================================
-- Set is_full_day to true for all existing rows (since they were created without time)
UPDATE booking_seasonal_periods
  SET is_full_day = true
  WHERE is_full_day IS NULL;

-- ============================================
-- ADD CONSTRAINT
-- ============================================
-- Drop existing constraint if it exists (for idempotency)
ALTER TABLE booking_seasonal_periods 
  DROP CONSTRAINT IF EXISTS check_time_range;

-- Add constraint to validate time range when not full day
ALTER TABLE booking_seasonal_periods
  ADD CONSTRAINT check_time_range CHECK (
    is_full_day = true OR 
    (start_time IS NOT NULL AND end_time IS NOT NULL AND 
     (end_date > start_date OR (end_date = start_date AND end_time >= start_time)))
  );

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON COLUMN booking_seasonal_periods.start_time IS 'Start time of the seasonal period (NULL if is_full_day is true)';
COMMENT ON COLUMN booking_seasonal_periods.end_time IS 'End time of the seasonal period (NULL if is_full_day is true)';
COMMENT ON COLUMN booking_seasonal_periods.is_full_day IS 'Whether this period applies to the full day (true) or specific time range (false)';
