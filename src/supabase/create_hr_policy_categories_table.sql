-- Create hr_policy_categories table for custom policy categories per business
-- Categories are used to organize policy content, with dynamic numbering based on usage

CREATE TABLE IF NOT EXISTS hr_policy_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_name TEXT NOT NULL, -- The category name (e.g., "General Provisions", "Employee Conduct")
  description TEXT, -- Optional description
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0, -- For custom ordering in dropdowns
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  
  -- Ensure unique category name per business
  UNIQUE(business_id, category_name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_hr_policy_categories_business_id ON hr_policy_categories(business_id);
CREATE INDEX IF NOT EXISTS idx_hr_policy_categories_is_active ON hr_policy_categories(is_active);
CREATE INDEX IF NOT EXISTS idx_hr_policy_categories_display_order ON hr_policy_categories(display_order);

-- Enable RLS
ALTER TABLE hr_policy_categories ENABLE ROW LEVEL SECURITY;

-- RLS Policies for hr_policy_categories
-- Users can view policy categories for their business
CREATE POLICY "Users can view policy categories for their business"
  ON hr_policy_categories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.business_id = hr_policy_categories.business_id
      AND user_roles.user_id = auth.uid()
      AND (user_roles.active = true OR user_roles.active IS NULL)
    )
    OR EXISTS (
      SELECT 1 FROM business_users
      WHERE business_users.business_id = hr_policy_categories.business_id
      AND business_users.user_id = auth.uid()
    )
  );

-- Users with elevated roles can create policy categories
CREATE POLICY "Elevated users can create policy categories"
  ON hr_policy_categories FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.business_id = hr_policy_categories.business_id
      AND user_roles.user_id = auth.uid()
      AND user_roles.role IN ('owner', 'manager', 'admin', 'hr_admin')
      AND (user_roles.active = true OR user_roles.active IS NULL)
    )
  );

-- Users with elevated roles can update policy categories
CREATE POLICY "Elevated users can update policy categories"
  ON hr_policy_categories FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.business_id = hr_policy_categories.business_id
      AND user_roles.user_id = auth.uid()
      AND user_roles.role IN ('owner', 'manager', 'admin', 'hr_admin')
      AND (user_roles.active = true OR user_roles.active IS NULL)
    )
  );

-- Users with elevated roles can delete policy categories
CREATE POLICY "Elevated users can delete policy categories"
  ON hr_policy_categories FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.business_id = hr_policy_categories.business_id
      AND user_roles.user_id = auth.uid()
      AND user_roles.role IN ('owner', 'manager', 'admin', 'hr_admin')
      AND (user_roles.active = true OR user_roles.active IS NULL)
    )
  );

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_hr_policy_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_hr_policy_categories_updated_at
  BEFORE UPDATE ON hr_policy_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_hr_policy_categories_updated_at();

-- Add comments
COMMENT ON TABLE hr_policy_categories IS 'Custom policy categories that businesses can define. Categories are numbered dynamically based on usage in policies.';
COMMENT ON COLUMN hr_policy_categories.category_name IS 'The category name (e.g., "General Provisions", "Employee Conduct")';
COMMENT ON COLUMN hr_policy_categories.description IS 'Optional description of the category';
COMMENT ON COLUMN hr_policy_categories.display_order IS 'Order for displaying categories in dropdowns and lists';



