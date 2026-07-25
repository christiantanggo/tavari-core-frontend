-- Fix waiver_uploads table to make file_url nullable
-- Since we're using signed URLs now, file_url is optional (stored as placeholder)

DO $$
BEGIN
  -- Check if file_url column exists and is NOT NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'waiver_uploads' 
    AND column_name = 'file_url'
    AND is_nullable = 'NO'
  ) THEN
    -- Make file_url nullable
    ALTER TABLE waiver_uploads 
    ALTER COLUMN file_url DROP NOT NULL;
    
    RAISE NOTICE 'Made file_url nullable in waiver_uploads table';
  ELSE
    RAISE NOTICE 'file_url column already nullable or does not exist';
  END IF;
END $$;

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';





