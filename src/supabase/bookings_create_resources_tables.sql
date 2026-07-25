-- ============================================
-- BOOKING RESOURCES TABLES
-- ============================================
-- Tables for managing booking resources (rooms, equipment, etc.)
-- Structure: Categories contain multiple resources

-- ============================================
-- TABLE: booking_resource_categories
-- ============================================
-- Stores resource categories (e.g., "Party Rooms", "Equipment", "Vehicles")
CREATE TABLE IF NOT EXISTS booking_resource_categories (
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
ALTER TABLE booking_resource_categories 
  DROP CONSTRAINT IF EXISTS booking_resource_categories_business_id_fkey;

-- Add foreign key constraint
ALTER TABLE booking_resource_categories
  ADD CONSTRAINT booking_resource_categories_business_id_fkey 
    FOREIGN KEY (business_id) 
    REFERENCES businesses(id) 
    ON DELETE CASCADE;

-- ============================================
-- TABLE: booking_resources
-- ============================================
-- Stores individual resources within categories
CREATE TABLE IF NOT EXISTS booking_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  category_id UUID NOT NULL,
  resource_name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Drop existing constraints if they exist (for idempotency)
ALTER TABLE booking_resources 
  DROP CONSTRAINT IF EXISTS booking_resources_business_id_fkey;
  
ALTER TABLE booking_resources 
  DROP CONSTRAINT IF EXISTS booking_resources_category_id_fkey;

-- Add foreign key constraints
ALTER TABLE booking_resources
  ADD CONSTRAINT booking_resources_business_id_fkey 
    FOREIGN KEY (business_id) 
    REFERENCES businesses(id) 
    ON DELETE CASCADE;
    
ALTER TABLE booking_resources
  ADD CONSTRAINT booking_resources_category_id_fkey 
    FOREIGN KEY (category_id) 
    REFERENCES booking_resource_categories(id) 
    ON DELETE CASCADE;

-- ============================================
-- INDEXES: booking_resource_categories
-- ============================================
-- Index for business lookups
CREATE INDEX IF NOT EXISTS idx_booking_resource_categories_business 
  ON booking_resource_categories(business_id);

-- Index for active categories by business
CREATE INDEX IF NOT EXISTS idx_booking_resource_categories_business_active 
  ON booking_resource_categories(business_id, is_active) 
  WHERE is_active = true;

-- Index for display order sorting
CREATE INDEX IF NOT EXISTS idx_booking_resource_categories_display_order 
  ON booking_resource_categories(business_id, display_order, is_active) 
  WHERE is_active = true;

-- ============================================
-- INDEXES: booking_resources
-- ============================================
-- Index for business lookups
CREATE INDEX IF NOT EXISTS idx_booking_resources_business 
  ON booking_resources(business_id);

-- Index for category lookups
CREATE INDEX IF NOT EXISTS idx_booking_resources_category 
  ON booking_resources(category_id);

-- Index for active resources by category
CREATE INDEX IF NOT EXISTS idx_booking_resources_category_active 
  ON booking_resources(category_id, is_active) 
  WHERE is_active = true;

-- Index for business and active resources
CREATE INDEX IF NOT EXISTS idx_booking_resources_business_active 
  ON booking_resources(business_id, is_active) 
  WHERE is_active = true;

-- Index for display order sorting
CREATE INDEX IF NOT EXISTS idx_booking_resources_display_order 
  ON booking_resources(category_id, display_order, is_active) 
  WHERE is_active = true;

-- ============================================
-- ROW LEVEL SECURITY (RLS): booking_resource_categories
-- ============================================
-- Enable RLS
ALTER TABLE booking_resource_categories ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view resource categories for their business" ON booking_resource_categories;
DROP POLICY IF EXISTS "Managers and owners can create resource categories" ON booking_resource_categories;
DROP POLICY IF EXISTS "Managers and owners can update resource categories" ON booking_resource_categories;
DROP POLICY IF EXISTS "Managers and owners can delete resource categories" ON booking_resource_categories;

-- Policy: Users can view resource categories for their business
CREATE POLICY "Users can view resource categories for their business"
  ON booking_resource_categories
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_resource_categories.business_id
      AND bu.user_id = auth.uid()
    )
  );

-- Policy: Managers and owners can create resource categories
CREATE POLICY "Managers and owners can create resource categories"
  ON booking_resource_categories
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_resource_categories.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- Policy: Managers and owners can update resource categories
CREATE POLICY "Managers and owners can update resource categories"
  ON booking_resource_categories
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_resource_categories.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_resource_categories.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- Policy: Managers and owners can delete resource categories
CREATE POLICY "Managers and owners can delete resource categories"
  ON booking_resource_categories
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_resource_categories.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- ============================================
-- ROW LEVEL SECURITY (RLS): booking_resources
-- ============================================
-- Enable RLS
ALTER TABLE booking_resources ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view resources for their business" ON booking_resources;
DROP POLICY IF EXISTS "Managers and owners can create resources" ON booking_resources;
DROP POLICY IF EXISTS "Managers and owners can update resources" ON booking_resources;
DROP POLICY IF EXISTS "Managers and owners can delete resources" ON booking_resources;

-- Policy: Users can view resources for their business
CREATE POLICY "Users can view resources for their business"
  ON booking_resources
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_resources.business_id
      AND bu.user_id = auth.uid()
    )
  );

-- Policy: Managers and owners can create resources
CREATE POLICY "Managers and owners can create resources"
  ON booking_resources
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_resources.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- Policy: Managers and owners can update resources
CREATE POLICY "Managers and owners can update resources"
  ON booking_resources
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_resources.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_resources.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- Policy: Managers and owners can delete resources
CREATE POLICY "Managers and owners can delete resources"
  ON booking_resources
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.business_id = booking_resources.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('manager', 'owner')
    )
  );

-- ============================================
-- TRIGGERS: booking_resource_categories
-- ============================================
-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_booking_resource_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_booking_resource_categories_updated_at ON booking_resource_categories;
CREATE TRIGGER trigger_update_booking_resource_categories_updated_at
  BEFORE UPDATE ON booking_resource_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_booking_resource_categories_updated_at();

-- ============================================
-- TRIGGERS: booking_resources
-- ============================================
-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_booking_resources_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_booking_resources_updated_at ON booking_resources;
CREATE TRIGGER trigger_update_booking_resources_updated_at
  BEFORE UPDATE ON booking_resources
  FOR EACH ROW
  EXECUTE FUNCTION update_booking_resources_updated_at();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE booking_resource_categories IS 'Stores resource categories for bookings (e.g., Party Rooms, Equipment)';
COMMENT ON COLUMN booking_resource_categories.category_name IS 'Name of the resource category';
COMMENT ON COLUMN booking_resource_categories.display_order IS 'Order for displaying categories (lower numbers first)';
COMMENT ON COLUMN booking_resource_categories.is_active IS 'Whether the category is active and available for use';

COMMENT ON TABLE booking_resources IS 'Stores individual resources within categories';
COMMENT ON COLUMN booking_resources.category_id IS 'Foreign key to booking_resource_categories';
COMMENT ON COLUMN booking_resources.resource_name IS 'Name of the resource (e.g., Red Room, Projector A)';
COMMENT ON COLUMN booking_resources.display_order IS 'Order for displaying resources within category (lower numbers first)';
COMMENT ON COLUMN booking_resources.is_active IS 'Whether the resource is active and available for use';
