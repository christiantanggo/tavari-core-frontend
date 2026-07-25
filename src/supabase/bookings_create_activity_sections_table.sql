-- ============================================
-- BOOKING ACTIVITY SECTIONS TABLE
-- ============================================
-- Table for storing additional information sections for booking activities
-- Each section has a header (e.g., "What to Bring", "Itinerary") and details
-- Used in: Booking Settings > Booking Categories > Regular > Name / Definition

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS booking_activity_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES booking_activities(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  section_header TEXT NOT NULL,
  section_details TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
-- Index for activity lookups
CREATE INDEX IF NOT EXISTS idx_booking_activity_sections_activity 
  ON booking_activity_sections(activity_id);

-- Index for business lookups
CREATE INDEX IF NOT EXISTS idx_booking_activity_sections_business 
  ON booking_activity_sections(business_id);

-- Index for ordering sections within an activity
CREATE INDEX IF NOT EXISTS idx_booking_activity_sections_order 
  ON booking_activity_sections(activity_id, display_order);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
-- Enable RLS
ALTER TABLE booking_activity_sections ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view activity sections for their business" ON booking_activity_sections;
DROP POLICY IF EXISTS "Managers and owners can create activity sections" ON booking_activity_sections;
DROP POLICY IF EXISTS "Managers and owners can update activity sections" ON booking_activity_sections;
DROP POLICY IF EXISTS "Managers and owners can delete activity sections" ON booking_activity_sections;

-- Policy: Users can view activity sections for their business
CREATE POLICY "Users can view activity sections for their business"
  ON booking_activity_sections
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_activity_sections.business_id
      AND bu.user_id = auth.uid()
    )
  );

-- Policy: Managers and owners can create activity sections
CREATE POLICY "Managers and owners can create activity sections"
  ON booking_activity_sections
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_activity_sections.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- Policy: Managers and owners can update activity sections
CREATE POLICY "Managers and owners can update activity sections"
  ON booking_activity_sections
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_activity_sections.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_activity_sections.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- Policy: Managers and owners can delete activity sections
CREATE POLICY "Managers and owners can delete activity sections"
  ON booking_activity_sections
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_activity_sections.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- ============================================
-- TRIGGERS
-- ============================================
-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_booking_activity_sections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_booking_activity_sections_updated_at ON booking_activity_sections;
CREATE TRIGGER trigger_update_booking_activity_sections_updated_at
  BEFORE UPDATE ON booking_activity_sections
  FOR EACH ROW
  EXECUTE FUNCTION update_booking_activity_sections_updated_at();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE booking_activity_sections IS 'Stores additional information sections for booking activities (e.g., "What to Bring", "Itinerary", "Additional Details")';
COMMENT ON COLUMN booking_activity_sections.section_header IS 'Header/title for the section (e.g., "What to Bring", "Itinerary")';
COMMENT ON COLUMN booking_activity_sections.section_details IS 'Detailed content for the section';
COMMENT ON COLUMN booking_activity_sections.display_order IS 'Order in which sections should be displayed (0-based)';
