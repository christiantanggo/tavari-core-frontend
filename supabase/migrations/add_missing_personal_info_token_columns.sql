-- Add missing personal_info_token columns to hr_contracts and users tables
-- This is a quick fix if the columns weren't added in the main migration

-- ============================================================================
-- ADD PERSONAL_INFO_TOKEN TO HR_CONTRACTS
-- ============================================================================

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
    RAISE NOTICE 'Added personal_info_token column to hr_contracts table';
  ELSE
    RAISE NOTICE 'personal_info_token column already exists in hr_contracts table';
  END IF;
END $$;

-- ============================================================================
-- ADD PERSONAL_INFO_SUBMITTED_AT TO HR_CONTRACTS
-- ============================================================================

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
    RAISE NOTICE 'Added personal_info_submitted_at column to hr_contracts table';
  ELSE
    RAISE NOTICE 'personal_info_submitted_at column already exists in hr_contracts table';
  END IF;
END $$;

-- ============================================================================
-- ADD PERSONAL_INFO_TOKEN TO USERS
-- ============================================================================

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
    RAISE NOTICE 'Added personal_info_token column to users table';
  ELSE
    RAISE NOTICE 'personal_info_token column already exists in users table';
  END IF;
END $$;

-- ============================================================================
-- CREATE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_hr_contracts_personal_info_token ON hr_contracts(personal_info_token) WHERE personal_info_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_personal_info_token ON users(personal_info_token) WHERE personal_info_token IS NOT NULL;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 
    'VERIFICATION' as check_type,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'hr_contracts' 
            AND column_name = 'personal_info_token'
        )
        THEN '✅ hr_contracts.personal_info_token exists'
        ELSE '❌ hr_contracts.personal_info_token MISSING'
    END as hr_contracts_status,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'users' 
            AND column_name = 'personal_info_token'
        )
        THEN '✅ users.personal_info_token exists'
        ELSE '❌ users.personal_info_token MISSING'
    END as users_status;
















