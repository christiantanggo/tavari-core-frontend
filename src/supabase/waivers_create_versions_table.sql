-- Step 9: Create waiver_versions table
-- Purpose: Store version history for waiver templates

CREATE TABLE IF NOT EXISTS waiver_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES waiver_templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  waiver_content TEXT NOT NULL,
  fields_config JSONB,
  signature_config JSONB,
  is_current BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Unique constraint: one version number per template
  CONSTRAINT waiver_versions_template_version_unique UNIQUE (template_id, version_number)
);

-- Create index for template lookup and version ordering
CREATE INDEX IF NOT EXISTS idx_waiver_versions_template 
  ON waiver_versions (template_id, version_number DESC);

-- Enable RLS (policies will be created in Step 50)
ALTER TABLE waiver_versions ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE waiver_versions IS 'Version history for waiver templates to track changes over time';




