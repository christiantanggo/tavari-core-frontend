-- Step 25: Create index on waiver_templates for active templates
-- Purpose: Fast active template lookup

CREATE INDEX IF NOT EXISTS idx_waiver_templates_active 
  ON waiver_templates (business_id, is_active, created_at DESC) 
  WHERE is_active = true;

-- Add comment
COMMENT ON INDEX idx_waiver_templates_active IS 'Partial index for fast active template lookup by business';




