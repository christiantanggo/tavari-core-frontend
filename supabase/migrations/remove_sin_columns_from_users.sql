-- Remove sin and sin_number columns from users table
-- These columns are no longer used - SIN data is now encrypted and stored in employee_sin_numbers table
-- This migration improves security by removing plain text SIN storage

-- Drop the columns if they exist
DO $$
BEGIN
  -- Drop sin_number column if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'sin_number'
  ) THEN
    ALTER TABLE public.users DROP COLUMN sin_number;
    RAISE NOTICE 'Dropped sin_number column from users table';
  END IF;

  -- Drop sin column if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'sin'
  ) THEN
    ALTER TABLE public.users DROP COLUMN sin;
    RAISE NOTICE 'Dropped sin column from users table';
  END IF;
END $$;

-- Verify columns are removed
SELECT 
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND column_name IN ('sin', 'sin_number');

-- Expected result: 0 rows (columns should be removed)








