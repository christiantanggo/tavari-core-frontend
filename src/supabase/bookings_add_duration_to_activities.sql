-- ============================================
-- ADD DURATION SUPPORT TO BOOKING ACTIVITIES
-- ============================================
-- Ensures duration_minutes column exists and adds indexes for duration queries

-- ============================================
-- ALTER TABLE: booking_activities
-- ============================================
-- Add duration_minutes column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'booking_activities' 
    AND column_name = 'duration_minutes'
  ) THEN
    ALTER TABLE booking_activities 
    ADD COLUMN duration_minutes INTEGER DEFAULT 30 CHECK (duration_minutes > 0);
    
    COMMENT ON COLUMN booking_activities.duration_minutes IS 'Duration of the activity in minutes. Default: 30 minutes';
  END IF;
END $$;

-- Update existing records that might have NULL duration
UPDATE booking_activities 
SET duration_minutes = 30 
WHERE duration_minutes IS NULL OR duration_minutes <= 0;

-- Make duration_minutes NOT NULL if it's currently nullable
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'booking_activities' 
    AND column_name = 'duration_minutes'
    AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE booking_activities 
    ALTER COLUMN duration_minutes SET NOT NULL;
  END IF;
END $$;

-- ============================================
-- INDEXES
-- ============================================
-- Index for duration-based queries (e.g., filter by duration range)
CREATE INDEX IF NOT EXISTS idx_booking_activities_duration 
  ON booking_activities(business_id, duration_minutes) 
  WHERE is_active = true;

-- Composite index for common queries (type, duration, active)
CREATE INDEX IF NOT EXISTS idx_booking_activities_type_duration 
  ON booking_activities(type_id, duration_minutes, is_active) 
  WHERE is_active = true;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON COLUMN booking_activities.duration_minutes IS 'Duration of the activity in minutes. Used to calculate booking end times and availability windows. Default: 30 minutes';
