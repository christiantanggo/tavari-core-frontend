-- Add waiver_filled_date column to waiver_uploads table
-- This stores the date that the waiver was actually filled/signed by the participant
-- (different from uploaded_at which is when it was uploaded to the system)

DO $$
BEGIN
  -- Add waiver_filled_date column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'waiver_uploads' 
    AND column_name = 'waiver_filled_date'
  ) THEN
    ALTER TABLE waiver_uploads 
    ADD COLUMN waiver_filled_date DATE;
    
    RAISE NOTICE 'Added waiver_filled_date column to waiver_uploads';
  ELSE
    RAISE NOTICE 'waiver_filled_date column already exists in waiver_uploads';
  END IF;
  
  -- Add date_of_birth column if it doesn't exist (also missing from original schema)
  -- This is a separate IF block to ensure it's added regardless of waiver_filled_date status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'waiver_uploads' 
    AND column_name = 'date_of_birth'
  ) THEN
    ALTER TABLE waiver_uploads 
    ADD COLUMN date_of_birth DATE;
    
    RAISE NOTICE 'Added date_of_birth column to waiver_uploads';
  ELSE
    RAISE NOTICE 'date_of_birth column already exists in waiver_uploads';
  END IF;
END $$;

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';

