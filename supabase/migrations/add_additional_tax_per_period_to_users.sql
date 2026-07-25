-- Add additional_tax_per_period column to users table
-- This allows HR to set a default additional tax amount per pay period for each employee
-- This amount will automatically be included in payroll runs

DO $$
BEGIN
  -- Add additional_tax_per_period column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'users' 
    AND column_name = 'additional_tax_per_period'
  ) THEN
    ALTER TABLE users 
    ADD COLUMN additional_tax_per_period numeric DEFAULT 0;
    
    COMMENT ON COLUMN users.additional_tax_per_period IS 'Additional federal tax amount to deduct per pay period (set in employee profile, automatically included in payroll runs)';
  END IF;
END $$;

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';












