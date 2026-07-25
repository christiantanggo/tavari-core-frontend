-- Step 24: Create index on waiver_uploads for customer lookup
-- Purpose: Fast lookup of uploaded paper waivers by customer

CREATE INDEX IF NOT EXISTS idx_waiver_uploads_customer_search 
  ON waiver_uploads (business_id, customer_id, first_name, last_name) 
  WHERE customer_id IS NOT NULL;

-- Add comment
COMMENT ON INDEX idx_waiver_uploads_customer_search IS 'Partial index for fast lookup of uploaded paper waivers by customer';




