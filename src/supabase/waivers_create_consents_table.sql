-- Step 5: Create waiver_consents table
-- Purpose: Store consent tracking for waivers (marketing, photography, medical, etc.)

CREATE TABLE IF NOT EXISTS waiver_consents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  waiver_id UUID NOT NULL REFERENCES waiver_signatures(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('marketing', 'photography', 'medical', 'other')),
  consent_given BOOLEAN DEFAULT false,
  consent_text TEXT,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for waiver lookup
CREATE INDEX IF NOT EXISTS idx_waiver_consents_waiver 
  ON waiver_consents (waiver_id, consent_type);

-- Enable RLS (policies will be created in Step 42)
ALTER TABLE waiver_consents ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE waiver_consents IS 'Consent tracking for waivers including marketing, photography, medical, and other consent types';




