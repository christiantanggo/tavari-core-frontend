-- Add wage_premium column to positions table
ALTER TABLE positions 
ADD COLUMN IF NOT EXISTS wage_premium NUMERIC DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN positions.wage_premium IS 'Additional hourly wage premium for this position (added to base employee wage)';


