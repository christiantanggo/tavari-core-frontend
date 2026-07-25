-- Add tax_year column to hrpayroll_settings and hrpayroll_tax_settings tables
-- This allows users to toggle between 2025 and 2026 CRA tax calculations

DO $$
BEGIN
  -- Add tax_year to hrpayroll_settings table if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'hrpayroll_settings' 
    AND column_name = 'tax_year'
  ) THEN
    ALTER TABLE hrpayroll_settings 
    ADD COLUMN tax_year integer DEFAULT 2025;
    
    -- Set default to 2025 for existing records
    UPDATE hrpayroll_settings 
    SET tax_year = 2025 
    WHERE tax_year IS NULL;
    
    RAISE NOTICE 'Added tax_year column to hrpayroll_settings';
  ELSE
    RAISE NOTICE 'tax_year column already exists in hrpayroll_settings';
  END IF;

  -- Add tax_year to hrpayroll_tax_settings table if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'hrpayroll_tax_settings' 
    AND column_name = 'tax_year'
  ) THEN
    ALTER TABLE hrpayroll_tax_settings 
    ADD COLUMN tax_year integer DEFAULT 2025;
    
    -- Set default to 2025 for existing records
    UPDATE hrpayroll_tax_settings 
    SET tax_year = 2025 
    WHERE tax_year IS NULL;
    
    RAISE NOTICE 'Added tax_year column to hrpayroll_tax_settings';
  ELSE
    RAISE NOTICE 'tax_year column already exists in hrpayroll_tax_settings';
  END IF;

END $$;

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';





