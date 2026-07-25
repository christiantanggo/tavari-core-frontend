-- Add personal_info_token to users table for independent personal info form access
-- This allows the form to work independently of contracts

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'personal_info_token'
  ) THEN
    ALTER TABLE users ADD COLUMN personal_info_token TEXT;
    COMMENT ON COLUMN users.personal_info_token IS 'Unique token for personal information form access (independent of contracts)';
  END IF;
END $$;

-- Create index on personal_info_token for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_personal_info_token ON users(personal_info_token) WHERE personal_info_token IS NOT NULL;
















