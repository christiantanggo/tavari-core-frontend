-- Step 2: Create waiver_signatures table
-- Purpose: Store signed waivers with signature data and customer information

CREATE TABLE IF NOT EXISTS waiver_signatures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES waiver_templates(id) ON DELETE RESTRICT,
  signature_token TEXT UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  phone_number TEXT,
  email TEXT,
  address TEXT,
  postal_code TEXT,
  signature_image_url TEXT,
  signature_data JSONB,
  guardian_signature_url TEXT,
  guardian_signature_data JSONB,
  guardian_name TEXT,
  is_minor BOOLEAN DEFAULT false,
  is_valid BOOLEAN DEFAULT true,
  signed_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  customer_id UUID REFERENCES pos_loyalty_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_waiver_signatures_customer 
  ON waiver_signatures (customer_id, signed_at DESC) 
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_waiver_signatures_search 
  ON waiver_signatures (first_name, last_name, phone_number, email);

CREATE INDEX IF NOT EXISTS idx_waiver_signatures_token 
  ON waiver_signatures (signature_token) 
  WHERE signature_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_waiver_signatures_expiry 
  ON waiver_signatures (expires_at, is_valid) 
  WHERE expires_at IS NOT NULL;

-- Enable RLS (policies will be created in Step 36)
ALTER TABLE waiver_signatures ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE waiver_signatures IS 'Signed waivers with signature data, customer information, and validity status';




