-- Add ALL missing columns for personal information form
-- This ensures all required columns exist in both users and hr_contracts tables
-- Run this if you're getting "column does not exist" errors

-- ============================================================================
-- STEP 1: ADD ADDRESS COLUMNS TO USERS TABLE
-- ============================================================================

DO $$ 
BEGIN
  -- address_line1
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'address_line1'
  ) THEN
    ALTER TABLE users ADD COLUMN address_line1 TEXT;
    COMMENT ON COLUMN users.address_line1 IS 'Street address line 1';
  END IF;

  -- address_line2
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'address_line2'
  ) THEN
    ALTER TABLE users ADD COLUMN address_line2 TEXT;
    COMMENT ON COLUMN users.address_line2 IS 'Street address line 2 (optional)';
  END IF;

  -- address_city
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'address_city'
  ) THEN
    ALTER TABLE users ADD COLUMN address_city TEXT;
    COMMENT ON COLUMN users.address_city IS 'City';
  END IF;

  -- address_state
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'address_state'
  ) THEN
    ALTER TABLE users ADD COLUMN address_state TEXT;
    COMMENT ON COLUMN users.address_state IS 'State/Province';
  END IF;

  -- address_postal_code
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'address_postal_code'
  ) THEN
    ALTER TABLE users ADD COLUMN address_postal_code TEXT;
    COMMENT ON COLUMN users.address_postal_code IS 'Postal/ZIP code';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: ADD PERSONAL INFO FIELDS TO USERS TABLE
-- ============================================================================

DO $$ 
BEGIN
  -- sin
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'sin'
  ) THEN
    ALTER TABLE users ADD COLUMN sin TEXT;
    COMMENT ON COLUMN users.sin IS 'Social Insurance Number (9 digits, stored without formatting)';
  END IF;

  -- emergency_contact_name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'emergency_contact_name'
  ) THEN
    ALTER TABLE users ADD COLUMN emergency_contact_name TEXT;
    COMMENT ON COLUMN users.emergency_contact_name IS 'Name of emergency contact person';
  END IF;

  -- emergency_contact_phone
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'emergency_contact_phone'
  ) THEN
    ALTER TABLE users ADD COLUMN emergency_contact_phone TEXT;
    COMMENT ON COLUMN users.emergency_contact_phone IS 'Phone number of emergency contact';
  END IF;

  -- emergency_contact_relationship
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'emergency_contact_relationship'
  ) THEN
    ALTER TABLE users ADD COLUMN emergency_contact_relationship TEXT;
    COMMENT ON COLUMN users.emergency_contact_relationship IS 'Relationship to emergency contact (e.g., Spouse, Parent)';
  END IF;

  -- personal_info_token
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'users' 
    AND column_name = 'personal_info_token'
  ) THEN
    ALTER TABLE users ADD COLUMN personal_info_token TEXT;
    COMMENT ON COLUMN users.personal_info_token IS 'Unique token for personal information form access';
  END IF;
END $$;

-- ============================================================================
-- STEP 3: ADD PERSONAL INFO FIELDS TO HR_CONTRACTS TABLE
-- ============================================================================

DO $$ 
BEGIN
  -- personal_info_token
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'hr_contracts' 
    AND column_name = 'personal_info_token'
  ) THEN
    ALTER TABLE hr_contracts ADD COLUMN personal_info_token TEXT;
    COMMENT ON COLUMN hr_contracts.personal_info_token IS 'Unique token for personal information form access';
  END IF;

  -- personal_info_submitted_at
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

-- ============================================================================
-- STEP 4: CREATE INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_personal_info_token ON users(personal_info_token) WHERE personal_info_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hr_contracts_personal_info_token ON hr_contracts(personal_info_token) WHERE personal_info_token IS NOT NULL;

-- ============================================================================
-- STEP 5: FORCE SCHEMA CACHE REFRESH
-- ============================================================================

-- Notify PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';

-- Alternative notification
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- STEP 6: VERIFICATION
-- ============================================================================

-- Verify all columns were added
SELECT 
    'COLUMN VERIFICATION' as check_type,
    table_name,
    column_name,
    data_type,
    '✅ Column exists' as status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'users' AND column_name IN (
      'address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code',
      'sin', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
      'personal_info_token'
    ))
    OR (table_name = 'hr_contracts' AND column_name IN (
      'personal_info_token', 'personal_info_submitted_at'
    ))
  )
ORDER BY table_name, column_name;

-- ============================================================================
-- NOTES
-- ============================================================================
-- After running this migration:
-- 1. Wait 10-30 seconds for the schema cache to refresh
-- 2. Try the personal info form again
-- 3. If it still doesn't work, restart your Supabase project












