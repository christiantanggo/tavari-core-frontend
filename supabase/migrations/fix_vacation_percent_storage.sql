-- Fix vacation_percent values that are stored as percentages (>= 1.0) to be stored as decimals
-- This migration normalizes all vacation_percent values to be stored as decimals (0.04 for 4%, 0.06 for 6%)

DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  -- Update vacation_percent values that are >= 1.0 (stored as percentages) to decimals
  -- e.g., 4.0 -> 0.04, 6.0 -> 0.06, 4 -> 0.04
  UPDATE users
  SET vacation_percent = vacation_percent / 100.0
  WHERE vacation_percent IS NOT NULL
    AND vacation_percent >= 1.0;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  
  RAISE NOTICE 'Fixed % vacation_percent values (converted percentages >= 1.0 to decimals)', updated_count;
  
  -- Also fix any values between 1.0 and 10.0 that might be stored incorrectly
  -- Values like 400 should become 4.0, then divided by 100 to 0.04
  -- But we should be more careful here - if it's exactly 400, that's likely 4% stored incorrectly
  UPDATE users
  SET vacation_percent = (vacation_percent / 10.0) / 100.0
  WHERE vacation_percent IS NOT NULL
    AND vacation_percent >= 100.0
    AND vacation_percent < 1000.0;  -- Values between 100-999 are likely 4% stored as 400
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  
  IF updated_count > 0 THEN
    RAISE NOTICE 'Fixed % vacation_percent values that were stored as 400 (converted to 0.04)', updated_count;
  END IF;
END $$;

-- Verify the fix
SELECT 
  COUNT(*) as total_employees,
  COUNT(*) FILTER (WHERE vacation_percent IS NOT NULL AND vacation_percent >= 1.0) as still_incorrect,
  COUNT(*) FILTER (WHERE vacation_percent IS NOT NULL AND vacation_percent < 1.0) as correct_format,
  COUNT(*) FILTER (WHERE vacation_percent IS NULL) as null_values
FROM users
WHERE vacation_percent IS NOT NULL OR vacation_percent IS NULL;

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';





