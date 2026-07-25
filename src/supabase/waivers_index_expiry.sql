-- Step 22: Create index on waiver_signatures for expiry checks
-- Purpose: Optimize expiry validation queries

CREATE INDEX IF NOT EXISTS idx_waiver_signatures_expiry_check 
  ON waiver_signatures (business_id, expires_at, is_valid) 
  WHERE expires_at IS NOT NULL AND is_valid = true;

-- Add comment
COMMENT ON INDEX idx_waiver_signatures_expiry_check IS 'Partial index for fast expiry validation queries on valid waivers with expiry dates';




