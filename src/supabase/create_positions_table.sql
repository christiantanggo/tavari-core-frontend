-- Create positions table
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  position_name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  UNIQUE(business_id, position_name)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_positions_business_id ON positions(business_id);
CREATE INDEX IF NOT EXISTS idx_positions_is_active ON positions(is_active);

-- Enable RLS
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for positions table

-- Users can view positions in their business
CREATE POLICY "Users can view positions in their business"
ON positions FOR SELECT
USING (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid()
  )
);

-- Managers and owners can create positions
CREATE POLICY "Managers and owners can create positions"
ON positions FOR INSERT
WITH CHECK (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

-- Managers and owners can update positions
CREATE POLICY "Managers and owners can update positions"
ON positions FOR UPDATE
USING (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

-- Managers and owners can delete positions
CREATE POLICY "Managers and owners can delete positions"
ON positions FOR DELETE
USING (
  business_id IN (
    SELECT business_id FROM business_users 
    WHERE user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_positions_updated_at 
    BEFORE UPDATE ON positions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
