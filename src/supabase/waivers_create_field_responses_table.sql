-- Step 8: Create waiver_field_responses table
-- Purpose: Store responses to custom fields in signed waivers

CREATE TABLE IF NOT EXISTS waiver_field_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  waiver_id UUID NOT NULL REFERENCES waiver_signatures(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES waiver_fields(id) ON DELETE RESTRICT,
  response_value TEXT NOT NULL,
  response_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Unique constraint: one response per field per waiver
  CONSTRAINT waiver_field_responses_unique UNIQUE (waiver_id, field_id)
);

-- Create index for waiver lookup
CREATE INDEX IF NOT EXISTS idx_waiver_field_responses_waiver 
  ON waiver_field_responses (waiver_id);

-- Enable RLS (policies will be created in Step 48)
ALTER TABLE waiver_field_responses ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE waiver_field_responses IS 'Responses to custom fields filled out during waiver signing';




