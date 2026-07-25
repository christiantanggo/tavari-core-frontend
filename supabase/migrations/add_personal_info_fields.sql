-- Add personal information fields to users table for employee profiles
-- These fields are needed for the personal information form after contract signing

-- Add SIN number field (Social Insurance Number - 9 digits)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'sin'
  ) THEN
    ALTER TABLE users ADD COLUMN sin TEXT;
    COMMENT ON COLUMN users.sin IS 'Social Insurance Number (9 digits, stored without formatting)';
  END IF;
END $$;

-- Add emergency contact fields
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'emergency_contact_name'
  ) THEN
    ALTER TABLE users ADD COLUMN emergency_contact_name TEXT;
    COMMENT ON COLUMN users.emergency_contact_name IS 'Name of emergency contact person';
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'emergency_contact_phone'
  ) THEN
    ALTER TABLE users ADD COLUMN emergency_contact_phone TEXT;
    COMMENT ON COLUMN users.emergency_contact_phone IS 'Phone number of emergency contact';
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'emergency_contact_relationship'
  ) THEN
    ALTER TABLE users ADD COLUMN emergency_contact_relationship TEXT;
    COMMENT ON COLUMN users.emergency_contact_relationship IS 'Relationship to emergency contact (e.g., Spouse, Parent)';
  END IF;
END $$;

-- Add address fields if they don't exist (they might already exist from KiddConnect)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'address_line1'
  ) THEN
    ALTER TABLE users ADD COLUMN address_line1 TEXT;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'address_line2'
  ) THEN
    ALTER TABLE users ADD COLUMN address_line2 TEXT;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'address_city'
  ) THEN
    ALTER TABLE users ADD COLUMN address_city TEXT;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'address_state'
  ) THEN
    ALTER TABLE users ADD COLUMN address_state TEXT;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'address_postal_code'
  ) THEN
    ALTER TABLE users ADD COLUMN address_postal_code TEXT;
  END IF;
END $$;

-- Add personal_info_token and personal_info_submitted_at to hr_contracts table
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'hr_contracts' 
    AND column_name = 'personal_info_token'
  ) THEN
    ALTER TABLE hr_contracts ADD COLUMN personal_info_token TEXT;
    COMMENT ON COLUMN hr_contracts.personal_info_token IS 'Unique token for personal information form access';
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'hr_contracts' 
    AND column_name = 'personal_info_submitted_at'
  ) THEN
    ALTER TABLE hr_contracts ADD COLUMN personal_info_submitted_at TIMESTAMPTZ;
    COMMENT ON COLUMN hr_contracts.personal_info_submitted_at IS 'Timestamp when employee submitted personal information form';
  END IF;
END $$;

-- Create index on personal_info_token for faster lookups
CREATE INDEX IF NOT EXISTS idx_hr_contracts_personal_info_token ON hr_contracts(personal_info_token) WHERE personal_info_token IS NOT NULL;
















