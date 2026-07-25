-- Step 6: Create waiver_uploads table
-- Purpose: Store uploaded paper waivers and photos/scans

CREATE TABLE IF NOT EXISTS waiver_uploads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES pos_loyalty_accounts(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone_number TEXT,
  email TEXT,
  upload_type TEXT NOT NULL CHECK (upload_type IN ('paper_waiver', 'photo', 'scan')),
  file_url TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  notes TEXT,
  linked_waiver_id UUID REFERENCES waiver_signatures(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_waiver_uploads_customer 
  ON waiver_uploads (customer_id, uploaded_at DESC) 
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_waiver_uploads_search 
  ON waiver_uploads (first_name, last_name, phone_number);

-- Enable RLS (policies will be created in Step 44)
ALTER TABLE waiver_uploads ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE waiver_uploads IS 'Uploaded paper waivers, photos, and scans that can be linked to customers or digital waivers';




