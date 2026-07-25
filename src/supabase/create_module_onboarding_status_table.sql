-- Create module_onboarding_status table for tracking module setup completion
-- Run this in Supabase SQL Editor if you're getting 406 errors

CREATE TABLE IF NOT EXISTS module_onboarding_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  completed_steps JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_id, module_key)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_module_onboarding_business_module 
  ON module_onboarding_status(business_id, module_key);

CREATE INDEX IF NOT EXISTS idx_module_onboarding_completed 
  ON module_onboarding_status(business_id, completed) 
  WHERE completed = false;

-- Enable RLS
ALTER TABLE module_onboarding_status ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view onboarding status for their business"
  ON module_onboarding_status
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.business_id = module_onboarding_status.business_id
        AND ur.user_id = auth.uid()
        AND ur.active = true
    )
  );

CREATE POLICY "Owners and managers can manage onboarding status"
  ON module_onboarding_status
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.business_id = module_onboarding_status.business_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager', 'admin')
        AND ur.active = true
    )
  );

-- Create trigger for updated_at (only if function exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS update_module_onboarding_status_updated_at ON module_onboarding_status;
    CREATE TRIGGER update_module_onboarding_status_updated_at
      BEFORE UPDATE ON module_onboarding_status
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Add comments
COMMENT ON TABLE module_onboarding_status IS 'Tracks onboarding completion status for each module per business';
COMMENT ON COLUMN module_onboarding_status.completed_steps IS 'Array of completed step IDs';


