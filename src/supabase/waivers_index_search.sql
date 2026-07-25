-- Step 21: Create index on waiver_signatures for search
-- Purpose: Fast multi-field search for waiver lookup

CREATE INDEX IF NOT EXISTS idx_waiver_signatures_search_composite 
  ON waiver_signatures (business_id, first_name, last_name, phone_number, email);

-- Add comment
COMMENT ON INDEX idx_waiver_signatures_search_composite IS 'Composite index for fast multi-field waiver search by business, name, phone, and email';




