-- ============================================
-- BOOKING SEASONAL PERIODS TABLE
-- ============================================
-- Table for storing seasonal pricing periods for booking activities
-- Each period represents a date range with specific pricing (e.g., "Summer 2026", "Holiday Season")

-- ============================================
-- TABLE: booking_seasonal_periods
-- ============================================
CREATE TABLE IF NOT EXISTS booking_seasonal_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  period_name TEXT NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  is_full_day BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT check_date_range CHECK (end_date >= start_date),
  CONSTRAINT check_time_range CHECK (
    is_full_day = true OR 
    (start_time IS NOT NULL AND end_time IS NOT NULL AND 
     (end_date > start_date OR (end_date = start_date AND end_time >= start_time)))
  )
);

-- Drop existing constraint if it exists (for idempotency)
ALTER TABLE booking_seasonal_periods 
  DROP CONSTRAINT IF EXISTS booking_seasonal_periods_business_id_fkey;

-- Add foreign key constraint
ALTER TABLE booking_seasonal_periods
  ADD CONSTRAINT booking_seasonal_periods_business_id_fkey 
    FOREIGN KEY (business_id) 
    REFERENCES businesses(id) 
    ON DELETE CASCADE;

-- ============================================
-- INDEXES
-- ============================================
-- Index for business lookups
CREATE INDEX IF NOT EXISTS idx_booking_seasonal_periods_business 
  ON booking_seasonal_periods(business_id);

-- Index for active periods by business
CREATE INDEX IF NOT EXISTS idx_booking_seasonal_periods_business_active 
  ON booking_seasonal_periods(business_id, is_active) 
  WHERE is_active = true;

-- Index for date range queries (finding periods for a specific date)
CREATE INDEX IF NOT EXISTS idx_booking_seasonal_periods_date_range 
  ON booking_seasonal_periods(business_id, start_date, end_date, is_active) 
  WHERE is_active = true;

-- Index for period name lookups
CREATE INDEX IF NOT EXISTS idx_booking_seasonal_periods_name 
  ON booking_seasonal_periods(business_id, period_name);

-- Index for start date sorting
CREATE INDEX IF NOT EXISTS idx_booking_seasonal_periods_start_date 
  ON booking_seasonal_periods(business_id, start_date, is_active) 
  WHERE is_active = true;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
-- Enable RLS
ALTER TABLE booking_seasonal_periods ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view seasonal periods for their business" ON booking_seasonal_periods;
DROP POLICY IF EXISTS "Managers and owners can create seasonal periods" ON booking_seasonal_periods;
DROP POLICY IF EXISTS "Managers and owners can update seasonal periods" ON booking_seasonal_periods;
DROP POLICY IF EXISTS "Managers and owners can delete seasonal periods" ON booking_seasonal_periods;

-- Policy: Users can view seasonal periods for their business
CREATE POLICY "Users can view seasonal periods for their business"
  ON booking_seasonal_periods
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_seasonal_periods.business_id
      AND bu.user_id = auth.uid()
    )
  );

-- Policy: Managers and owners can create seasonal periods
CREATE POLICY "Managers and owners can create seasonal periods"
  ON booking_seasonal_periods
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_seasonal_periods.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- Policy: Managers and owners can update seasonal periods
CREATE POLICY "Managers and owners can update seasonal periods"
  ON booking_seasonal_periods
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_seasonal_periods.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_seasonal_periods.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- Policy: Managers and owners can delete seasonal periods
CREATE POLICY "Managers and owners can delete seasonal periods"
  ON booking_seasonal_periods
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_seasonal_periods.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- ============================================
-- TRIGGERS
-- ============================================
-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_booking_seasonal_periods_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists (for idempotency)
DROP TRIGGER IF EXISTS trigger_update_booking_seasonal_periods_updated_at ON booking_seasonal_periods;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_booking_seasonal_periods_updated_at
  BEFORE UPDATE ON booking_seasonal_periods
  FOR EACH ROW
  EXECUTE FUNCTION update_booking_seasonal_periods_updated_at();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE booking_seasonal_periods IS 'Stores seasonal pricing periods for booking activities (e.g., Summer 2026, Holiday Season)';
COMMENT ON COLUMN booking_seasonal_periods.business_id IS 'Foreign key to businesses table';
COMMENT ON COLUMN booking_seasonal_periods.period_name IS 'Name of the seasonal period (e.g., "Summer", "Holiday Season", "Peak Season")';
COMMENT ON COLUMN booking_seasonal_periods.description IS 'Optional description of the seasonal period';
COMMENT ON COLUMN booking_seasonal_periods.start_date IS 'Start date of the seasonal period (inclusive)';
COMMENT ON COLUMN booking_seasonal_periods.end_date IS 'End date of the seasonal period (inclusive)';
COMMENT ON COLUMN booking_seasonal_periods.start_time IS 'Start time of the seasonal period (NULL if is_full_day is true)';
COMMENT ON COLUMN booking_seasonal_periods.end_time IS 'End time of the seasonal period (NULL if is_full_day is true)';
COMMENT ON COLUMN booking_seasonal_periods.is_full_day IS 'Whether this period applies to the full day (true) or specific time range (false)';
COMMENT ON COLUMN booking_seasonal_periods.is_active IS 'Whether this period is currently active and available for use';
