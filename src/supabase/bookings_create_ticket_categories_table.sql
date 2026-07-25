-- ============================================
-- BOOKING TICKET CATEGORIES TABLE
-- ============================================
-- Table for storing ticket categories/types for booking activities
-- Each category represents a type of ticket (e.g., "Adult", "Child", "Senior", "VIP")

-- ============================================
-- TABLE: booking_ticket_categories
-- ============================================
CREATE TABLE IF NOT EXISTS booking_ticket_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  category_name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Drop existing constraint if it exists (for idempotency)
ALTER TABLE booking_ticket_categories 
  DROP CONSTRAINT IF EXISTS booking_ticket_categories_business_id_fkey;

-- Add foreign key constraint
ALTER TABLE booking_ticket_categories
  ADD CONSTRAINT booking_ticket_categories_business_id_fkey 
    FOREIGN KEY (business_id) 
    REFERENCES businesses(id) 
    ON DELETE CASCADE;

-- ============================================
-- INDEXES
-- ============================================
-- Index for business lookups
CREATE INDEX IF NOT EXISTS idx_booking_ticket_categories_business 
  ON booking_ticket_categories(business_id);

-- Index for active categories by business
CREATE INDEX IF NOT EXISTS idx_booking_ticket_categories_business_active 
  ON booking_ticket_categories(business_id, is_active) 
  WHERE is_active = true;

-- Index for display order sorting
CREATE INDEX IF NOT EXISTS idx_booking_ticket_categories_display_order 
  ON booking_ticket_categories(business_id, display_order, is_active) 
  WHERE is_active = true;

-- Index for category name lookups (for uniqueness checks)
CREATE INDEX IF NOT EXISTS idx_booking_ticket_categories_name 
  ON booking_ticket_categories(business_id, category_name);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
-- Enable RLS
ALTER TABLE booking_ticket_categories ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view ticket categories for their business" ON booking_ticket_categories;
DROP POLICY IF EXISTS "Managers and owners can create ticket categories" ON booking_ticket_categories;
DROP POLICY IF EXISTS "Managers and owners can update ticket categories" ON booking_ticket_categories;
DROP POLICY IF EXISTS "Managers and owners can delete ticket categories" ON booking_ticket_categories;

-- Policy: Users can view ticket categories for their business
CREATE POLICY "Users can view ticket categories for their business"
  ON booking_ticket_categories
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_ticket_categories.business_id
      AND bu.user_id = auth.uid()
    )
  );

-- Policy: Managers and owners can create ticket categories
CREATE POLICY "Managers and owners can create ticket categories"
  ON booking_ticket_categories
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_ticket_categories.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- Policy: Managers and owners can update ticket categories
CREATE POLICY "Managers and owners can update ticket categories"
  ON booking_ticket_categories
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_ticket_categories.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_ticket_categories.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- Policy: Managers and owners can delete ticket categories
CREATE POLICY "Managers and owners can delete ticket categories"
  ON booking_ticket_categories
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_ticket_categories.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- ============================================
-- TRIGGERS
-- ============================================
-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_booking_ticket_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists (for idempotency)
DROP TRIGGER IF EXISTS trigger_update_booking_ticket_categories_updated_at ON booking_ticket_categories;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_booking_ticket_categories_updated_at
  BEFORE UPDATE ON booking_ticket_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_booking_ticket_categories_updated_at();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE booking_ticket_categories IS 'Stores ticket categories/types for booking activities (e.g., Adult, Child, Senior, VIP)';
COMMENT ON COLUMN booking_ticket_categories.business_id IS 'Foreign key to businesses table';
COMMENT ON COLUMN booking_ticket_categories.category_name IS 'Name of the ticket category (e.g., "Adult", "Child", "Senior")';
COMMENT ON COLUMN booking_ticket_categories.description IS 'Optional description of the ticket category';
COMMENT ON COLUMN booking_ticket_categories.display_order IS 'Order in which categories should be displayed (lower numbers first)';
COMMENT ON COLUMN booking_ticket_categories.is_active IS 'Whether this category is currently active and available for use';
