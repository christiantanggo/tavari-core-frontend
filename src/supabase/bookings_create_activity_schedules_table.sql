-- ============================================
-- BOOKING ACTIVITY SCHEDULES TABLE
-- ============================================
-- Table for storing weekly schedule time slots for booking activities
-- Each row represents a time slot on a specific day of the week

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS booking_activity_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES booking_activities(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0=Sunday, 1=Monday, ..., 6=Saturday
  start_time TEXT NOT NULL, -- Format: "XX:XX AM/PM" (e.g., "09:00 AM", "2:30 PM")
  spaces INTEGER NOT NULL DEFAULT 1 CHECK (spaces > 0), -- Number of concurrent bookings allowed
  resource_assignments JSONB DEFAULT '{}'::jsonb, -- { "resourceCategoryId": "resourceId" }
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
-- Index for activity lookups
CREATE INDEX IF NOT EXISTS idx_booking_activity_schedules_activity 
  ON booking_activity_schedules(activity_id);

-- Index for business lookups
CREATE INDEX IF NOT EXISTS idx_booking_activity_schedules_business 
  ON booking_activity_schedules(business_id);

-- Index for day of week queries
CREATE INDEX IF NOT EXISTS idx_booking_activity_schedules_day 
  ON booking_activity_schedules(activity_id, day_of_week, is_active) 
  WHERE is_active = true;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
-- Enable RLS
ALTER TABLE booking_activity_schedules ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view activity schedules for their business" ON booking_activity_schedules;
DROP POLICY IF EXISTS "Managers and owners can create activity schedules" ON booking_activity_schedules;
DROP POLICY IF EXISTS "Managers and owners can update activity schedules" ON booking_activity_schedules;
DROP POLICY IF EXISTS "Managers and owners can delete activity schedules" ON booking_activity_schedules;

-- Policy: Users can view activity schedules for their business
CREATE POLICY "Users can view activity schedules for their business"
  ON booking_activity_schedules
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_activity_schedules.business_id
      AND bu.user_id = auth.uid()
    )
  );

-- Policy: Managers and owners can create activity schedules
CREATE POLICY "Managers and owners can create activity schedules"
  ON booking_activity_schedules
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_activity_schedules.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- Policy: Managers and owners can update activity schedules
CREATE POLICY "Managers and owners can update activity schedules"
  ON booking_activity_schedules
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_activity_schedules.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_activity_schedules.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- Policy: Managers and owners can delete activity schedules
CREATE POLICY "Managers and owners can delete activity schedules"
  ON booking_activity_schedules
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_activity_schedules.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- ============================================
-- TRIGGERS
-- ============================================
-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_booking_activity_schedules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_booking_activity_schedules_updated_at ON booking_activity_schedules;
CREATE TRIGGER trigger_update_booking_activity_schedules_updated_at
  BEFORE UPDATE ON booking_activity_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_booking_activity_schedules_updated_at();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE booking_activity_schedules IS 'Stores weekly schedule time slots for booking activities';
COMMENT ON COLUMN booking_activity_schedules.day_of_week IS 'Day of week: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday';
COMMENT ON COLUMN booking_activity_schedules.start_time IS 'Start time in format "XX:XX AM/PM" (e.g., "09:00 AM", "2:30 PM")';
COMMENT ON COLUMN booking_activity_schedules.spaces IS 'Number of concurrent bookings allowed at this time slot';
COMMENT ON COLUMN booking_activity_schedules.resource_assignments IS 'JSONB object mapping resource category IDs to selected resource IDs';
