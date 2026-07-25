-- Add missing columns to hrpayroll_settings table
-- These columns are expected by usePayrollCalculations.js

-- Check if table exists first
DO $$
BEGIN
  -- Add pay_period_type (maps to pay_frequency, but keeping both for compatibility)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'hrpayroll_settings' 
    AND column_name = 'pay_period_type'
  ) THEN
    ALTER TABLE hrpayroll_settings 
    ADD COLUMN pay_period_type text;
    
    -- Copy from pay_frequency if it exists
    UPDATE hrpayroll_settings 
    SET pay_period_type = pay_frequency 
    WHERE pay_period_type IS NULL AND pay_frequency IS NOT NULL;
  END IF;

  -- Add pay_period_start_day
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'hrpayroll_settings' 
    AND column_name = 'pay_period_start_day'
  ) THEN
    ALTER TABLE hrpayroll_settings 
    ADD COLUMN pay_period_start_day integer;
  END IF;

  -- Add overtime_threshold
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'hrpayroll_settings' 
    AND column_name = 'overtime_threshold'
  ) THEN
    ALTER TABLE hrpayroll_settings 
    ADD COLUMN overtime_threshold numeric DEFAULT 8.0;
  END IF;

  -- Add vacation_rate (maps to default_vacation_percent, but keeping both)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'hrpayroll_settings' 
    AND column_name = 'vacation_rate'
  ) THEN
    ALTER TABLE hrpayroll_settings 
    ADD COLUMN vacation_rate numeric;
    
    -- Copy from default_vacation_percent if it exists
    UPDATE hrpayroll_settings 
    SET vacation_rate = default_vacation_percent 
    WHERE vacation_rate IS NULL AND default_vacation_percent IS NOT NULL;
  END IF;

  -- Add stat_holiday_rate
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'hrpayroll_settings' 
    AND column_name = 'stat_holiday_rate'
  ) THEN
    ALTER TABLE hrpayroll_settings 
    ADD COLUMN stat_holiday_rate numeric DEFAULT 1.5;
  END IF;

END $$;

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';

