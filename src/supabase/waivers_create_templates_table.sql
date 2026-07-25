-- Step 1: Create waiver_templates table
-- Purpose: Store waiver template definitions for each business

CREATE TABLE IF NOT EXISTS waiver_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  template_key TEXT NOT NULL,
  waiver_title TEXT,
  waiver_content TEXT,
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  requires_digital_signature BOOLEAN DEFAULT true,
  requires_guardian_signature BOOLEAN DEFAULT false,
  minor_age_threshold INTEGER DEFAULT 18,
  fields_config JSONB,
  signature_config JSONB,
  expiry_days INTEGER,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Unique constraint: one template key per business per version
  CONSTRAINT waiver_templates_business_key_version_unique UNIQUE (business_id, template_key, version)
);

-- Create index for active templates lookup
CREATE INDEX IF NOT EXISTS idx_waiver_templates_business_active 
  ON waiver_templates (business_id, is_active) 
  WHERE is_active = true;

-- Enable RLS (policies will be created in Step 31)
ALTER TABLE waiver_templates ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE waiver_templates IS 'Waiver templates define the structure and content of waivers that can be signed by customers';




