-- Step 3: Create waiver_participants table
-- Purpose: Store participants in waivers (primary signer, guardians, additional adults, minors)

CREATE TABLE IF NOT EXISTS waiver_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  waiver_id UUID NOT NULL REFERENCES waiver_signatures(id) ON DELETE CASCADE,
  participant_type TEXT NOT NULL CHECK (participant_type IN ('primary', 'guardian', 'additional_adult', 'minor')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  phone_number TEXT,
  email TEXT,
  relationship_to_minor TEXT,
  signature_image_url TEXT,
  signature_data JSONB,
  signed_at TIMESTAMPTZ,
  is_required BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for waiver lookup
CREATE INDEX IF NOT EXISTS idx_waiver_participants_waiver 
  ON waiver_participants (waiver_id, participant_type);

-- Enable RLS (policies will be created in Step 38)
ALTER TABLE waiver_participants ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE waiver_participants IS 'Participants in waivers including primary signer, guardians, additional adults, and minors';




