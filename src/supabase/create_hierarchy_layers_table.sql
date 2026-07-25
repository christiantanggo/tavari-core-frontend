-- Create hierarchy_layers table for organizational structure
CREATE TABLE IF NOT EXISTS hierarchy_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#4a90e2',
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_hierarchy_layers_business_id ON hierarchy_layers(business_id);
CREATE INDEX IF NOT EXISTS idx_hierarchy_layers_display_order ON hierarchy_layers(display_order);
CREATE INDEX IF NOT EXISTS idx_hierarchy_layers_is_active ON hierarchy_layers(is_active);

-- Add trigger to update updated_at
DROP TRIGGER IF EXISTS update_hierarchy_layers_updated_at ON hierarchy_layers;
CREATE TRIGGER update_hierarchy_layers_updated_at
    BEFORE UPDATE ON hierarchy_layers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE hierarchy_layers ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view hierarchy layers in their business" ON hierarchy_layers;
CREATE POLICY "Users can view hierarchy layers in their business"
ON hierarchy_layers FOR SELECT
USING (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Managers and owners can create hierarchy layers" ON hierarchy_layers;
CREATE POLICY "Managers and owners can create hierarchy layers"
ON hierarchy_layers FOR INSERT
WITH CHECK (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

DROP POLICY IF EXISTS "Managers and owners can update hierarchy layers" ON hierarchy_layers;
CREATE POLICY "Managers and owners can update hierarchy layers"
ON hierarchy_layers FOR UPDATE
USING (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

DROP POLICY IF EXISTS "Managers and owners can delete hierarchy layers" ON hierarchy_layers;
CREATE POLICY "Managers and owners can delete hierarchy layers"
ON hierarchy_layers FOR DELETE
USING (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

-- Add comments
COMMENT ON TABLE hierarchy_layers IS 'Organizational hierarchy layers for employee structure';
COMMENT ON COLUMN hierarchy_layers.business_id IS 'The business this hierarchy layer belongs to';
COMMENT ON COLUMN hierarchy_layers.name IS 'Name of the hierarchy layer (e.g., "Management", "Staff")';
COMMENT ON COLUMN hierarchy_layers.description IS 'Optional description of the hierarchy layer';
COMMENT ON COLUMN hierarchy_layers.color IS 'Color code for displaying this layer in the chart';
COMMENT ON COLUMN hierarchy_layers.display_order IS 'Display order for the hierarchy layer (lower numbers appear first)';
