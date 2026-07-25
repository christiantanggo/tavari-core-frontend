-- Create position_premium_rules table for flexible premium management
CREATE TABLE IF NOT EXISTS position_premium_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  premium_name TEXT NOT NULL,
  premium_rate NUMERIC DEFAULT 0,
  roles_that_receive_premium TEXT[], -- Roles that receive this premium
  requires_no_concurrent_roles TEXT[], -- Roles that must NOT be clocked in for this premium to apply
  description TEXT,
  applies_to_all_hours BOOLEAN DEFAULT true, -- If true, applies to entire shift; if false, needs time tracking
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_position_premium_rules_position_id ON position_premium_rules(position_id);
CREATE INDEX IF NOT EXISTS idx_position_premium_rules_business_id ON position_premium_rules(business_id);
CREATE INDEX IF NOT EXISTS idx_position_premium_rules_is_active ON position_premium_rules(is_active);

-- Add trigger to update updated_at
DROP TRIGGER IF EXISTS update_position_premium_rules_updated_at ON position_premium_rules;
CREATE TRIGGER update_position_premium_rules_updated_at
    BEFORE UPDATE ON position_premium_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE position_premium_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view rules in their business" ON position_premium_rules;
CREATE POLICY "Users can view rules in their business"
ON position_premium_rules FOR SELECT
USING (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Managers and owners can create rules" ON position_premium_rules;
CREATE POLICY "Managers and owners can create rules"
ON position_premium_rules FOR INSERT
WITH CHECK (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

DROP POLICY IF EXISTS "Managers and owners can update rules" ON position_premium_rules;
CREATE POLICY "Managers and owners can update rules"
ON position_premium_rules FOR UPDATE
USING (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

DROP POLICY IF EXISTS "Managers and owners can delete rules" ON position_premium_rules;
CREATE POLICY "Managers and owners can delete rules"
ON position_premium_rules FOR DELETE
USING (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

-- Add comments
COMMENT ON TABLE position_premium_rules IS 'Flexible rules for position-based wage premiums';
COMMENT ON COLUMN position_premium_rules.position_id IS 'The position this rule applies to';
COMMENT ON COLUMN position_premium_rules.premium_name IS 'Name of the premium (e.g., "Shift Lead Premium")';
COMMENT ON COLUMN position_premium_rules.premium_rate IS 'Hourly rate of the premium';
COMMENT ON COLUMN position_premium_rules.roles_that_receive_premium IS 'Array of role names that receive this premium';
COMMENT ON COLUMN position_premium_rules.requires_no_concurrent_roles IS 'Array of roles that must NOT be clocked in for this premium to apply';

