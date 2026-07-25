-- Step 4: Create waiver_settings table
-- Purpose: Store configuration settings for waivers (global and per-template)

CREATE TABLE IF NOT EXISTS waiver_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  template_id UUID REFERENCES waiver_templates(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,
  setting_value JSONB NOT NULL,
  is_global BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add check constraint to ensure template_id is set when not global
ALTER TABLE waiver_settings 
  ADD CONSTRAINT waiver_settings_template_check 
  CHECK (
    (is_global = true AND template_id IS NULL) OR 
    (is_global = false AND template_id IS NOT NULL)
  );

-- Create partial unique index for template-specific settings
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiver_settings_template_unique 
  ON waiver_settings (business_id, template_id, setting_key) 
  WHERE template_id IS NOT NULL;

-- Create partial unique index for global settings
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiver_settings_global_unique 
  ON waiver_settings (business_id, setting_key) 
  WHERE is_global = true AND template_id IS NULL;

-- Create index for business lookup
CREATE INDEX IF NOT EXISTS idx_waiver_settings_business 
  ON waiver_settings (business_id, is_global);

-- Enable RLS (policies will be created in Step 40)
ALTER TABLE waiver_settings ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE waiver_settings IS 'Configuration settings for waivers, can be global or template-specific';

