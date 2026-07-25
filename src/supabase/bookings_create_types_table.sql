-- ============================================
-- BOOKING TYPES TABLE
-- ============================================
-- Table for storing booking categories/types
-- Used in: Booking Settings > Booking Categories

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS booking_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type_name TEXT NOT NULL,
  type_key TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  requires_waiver BOOLEAN DEFAULT false,
  requires_payment BOOLEAN DEFAULT true,
  custom_fields JSONB DEFAULT '{}'::jsonb,
  session_rules JSONB DEFAULT '{}'::jsonb,
  cancellation_rules JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT booking_types_business_type_key UNIQUE (business_id, type_key)
);

-- ============================================
-- INDEXES
-- ============================================
-- Index for active booking types by business
CREATE INDEX IF NOT EXISTS idx_booking_types_business_active 
  ON booking_types(business_id, is_active) 
  WHERE is_active = true;

-- Index for business_id lookups
CREATE INDEX IF NOT EXISTS idx_booking_types_business 
  ON booking_types(business_id);

-- Index for type_key lookups
CREATE INDEX IF NOT EXISTS idx_booking_types_key 
  ON booking_types(type_key);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
-- Enable RLS
ALTER TABLE booking_types ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view booking types for their business" ON booking_types;
DROP POLICY IF EXISTS "Managers and owners can create booking types" ON booking_types;
DROP POLICY IF EXISTS "Managers and owners can update booking types" ON booking_types;
DROP POLICY IF EXISTS "Managers and owners can delete booking types" ON booking_types;

-- Policy: Users can view booking types for their business
CREATE POLICY "Users can view booking types for their business"
  ON booking_types
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_types.business_id
      AND bu.user_id = auth.uid()
    )
  );

-- Policy: Managers and owners can create booking types
CREATE POLICY "Managers and owners can create booking types"
  ON booking_types
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_types.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- Policy: Managers and owners can update booking types
CREATE POLICY "Managers and owners can update booking types"
  ON booking_types
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_types.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_types.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- Policy: Managers and owners can delete booking types (soft delete via is_active)
CREATE POLICY "Managers and owners can delete booking types"
  ON booking_types
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_types.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- ============================================
-- TRIGGERS
-- ============================================
-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_booking_types_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_booking_types_updated_at ON booking_types;
CREATE TRIGGER trigger_update_booking_types_updated_at
  BEFORE UPDATE ON booking_types
  FOR EACH ROW
  EXECUTE FUNCTION update_booking_types_updated_at();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE booking_types IS 'Stores booking categories/types (e.g., Birthday Party, Drop-In, Special Event)';
COMMENT ON COLUMN booking_types.type_key IS 'Unique key for the type within a business (e.g., "birthday_party", "drop_in")';
COMMENT ON COLUMN booking_types.display_name IS 'User-friendly display name (defaults to type_name if not provided)';
COMMENT ON COLUMN booking_types.custom_fields IS 'JSONB object for storing custom field definitions';
COMMENT ON COLUMN booking_types.session_rules IS 'JSONB object for session-specific rules (duration, capacity, etc.)';
COMMENT ON COLUMN booking_types.cancellation_rules IS 'JSONB object for cancellation policies and rules';
