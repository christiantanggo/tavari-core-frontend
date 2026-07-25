-- Step 7: Create waiver_fields table
-- Purpose: Store custom form fields for waiver templates

CREATE TABLE IF NOT EXISTS waiver_fields (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES waiver_templates(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'textarea', 'date', 'phone', 'email', 'checkbox', 'radio', 'select')),
  field_options JSONB,
  is_required BOOLEAN DEFAULT false,
  display_order INTEGER DEFAULT 0,
  validation_rules JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for template lookup and ordering
CREATE INDEX IF NOT EXISTS idx_waiver_fields_template 
  ON waiver_fields (template_id, display_order);

-- Enable RLS (policies will be created in Step 46)
ALTER TABLE waiver_fields ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE waiver_fields IS 'Custom form fields for waiver templates that can be configured per template';




