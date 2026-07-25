-- Step 23: Create index on waiver_participants for family lookup
-- Purpose: Fast family waiver participant queries

CREATE INDEX IF NOT EXISTS idx_waiver_participants_family 
  ON waiver_participants (waiver_id, participant_type, relationship_to_minor);

-- Add comment
COMMENT ON INDEX idx_waiver_participants_family IS 'Index for fast family waiver participant queries by waiver, type, and relationship';




