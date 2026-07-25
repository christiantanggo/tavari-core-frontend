-- Complete setup for personal information form functionality
-- This migration creates all necessary tables, columns, and RLS policies
-- Run this migration to set up the personal info form system

-- ============================================================================
-- STEP 1: CREATE HR_CONTRACTS TABLE (if it doesn't exist)
-- ============================================================================

CREATE TABLE IF NOT EXISTS hr_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
  employee_email TEXT NOT NULL,
  employee_first_name TEXT,
  employee_last_name TEXT,
  employee_address TEXT,
  contract_data JSONB,
  contract_html TEXT,
  pdf_data BYTEA,
  pdf_url TEXT,
  signing_token TEXT UNIQUE,
  authorized_representative_signing_token TEXT UNIQUE,
  authorized_representative_name TEXT,
  authorized_representative_email TEXT,
  authorized_representative_signed_at TIMESTAMPTZ,
  hr_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  contract_type TEXT,
  employment_status TEXT,
  position_title TEXT,
  start_date DATE,
  end_date DATE,
  expiry_date DATE,
  probation_end_date DATE,
  wage_amount DECIMAL(10,2),
  wage_type TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  viewed_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  signed_pdf_data BYTEA,
  signed_pdf_url TEXT,
  signature_data JSONB,
  digital_signature_data JSONB,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- STEP 2: ADD PERSONAL_INFO_TOKEN COLUMN TO HR_CONTRACTS
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
  END IF;
END $$;

-- Add personal_info_submitted_at column
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

-- ============================================================================
-- STEP 3: ADD PERSONAL_INFO_TOKEN COLUMN TO USERS TABLE
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
  END IF;
END $$;

-- ============================================================================
-- STEP 4: CREATE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_hr_contracts_personal_info_token ON hr_contracts(personal_info_token) WHERE personal_info_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_personal_info_token ON users(personal_info_token) WHERE personal_info_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hr_contracts_business_id ON hr_contracts(business_id);
CREATE INDEX IF NOT EXISTS idx_hr_contracts_employee_id ON hr_contracts(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_contracts_employee_email ON hr_contracts(employee_email);
CREATE INDEX IF NOT EXISTS idx_hr_contracts_signing_token ON hr_contracts(signing_token);
CREATE INDEX IF NOT EXISTS idx_hr_contracts_status ON hr_contracts(status);

-- ============================================================================
-- STEP 5: ENABLE RLS ON HR_CONTRACTS (if not already enabled)
-- ============================================================================

ALTER TABLE hr_contracts ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 6: CREATE BASIC RLS POLICIES FOR HR_CONTRACTS (if they don't exist)
-- ============================================================================
-- Note: We'll create basic policies that work with or without user_roles table
-- The personal info form only needs the public token-based policies below

-- Check if user_roles table exists and create appropriate policies
DO $$
BEGIN
  -- Only create business owner policies if user_roles table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'user_roles'
  ) THEN
    -- Drop existing policies if they exist
    DROP POLICY IF EXISTS "Business owners can view their contracts" ON hr_contracts;
    DROP POLICY IF EXISTS "Business owners can create contracts" ON hr_contracts;
    DROP POLICY IF EXISTS "Business owners can update contracts" ON hr_contracts;

    -- Create basic business owner policies using user_roles
    EXECUTE '
    CREATE POLICY "Business owners can view their contracts"
      ON hr_contracts FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM user_roles
          WHERE user_roles.user_id = auth.uid()
          AND user_roles.business_id = hr_contracts.business_id
          AND user_roles.role IN (''owner'', ''manager'', ''admin'')
          AND (user_roles.active = true OR user_roles.active IS NULL)
        )
      )';

    EXECUTE '
    CREATE POLICY "Business owners can create contracts"
      ON hr_contracts FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM user_roles
          WHERE user_roles.user_id = auth.uid()
          AND user_roles.business_id = hr_contracts.business_id
          AND user_roles.role IN (''owner'', ''manager'', ''admin'')
          AND (user_roles.active = true OR user_roles.active IS NULL)
        )
      )';

    EXECUTE '
    CREATE POLICY "Business owners can update contracts"
      ON hr_contracts FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM user_roles
          WHERE user_roles.user_id = auth.uid()
          AND user_roles.business_id = hr_contracts.business_id
          AND user_roles.role IN (''owner'', ''manager'', ''admin'')
          AND (user_roles.active = true OR user_roles.active IS NULL)
        )
      )';
  ELSE
    -- If user_roles doesn't exist, create simpler policies
    -- These allow authenticated users to manage contracts for businesses they created
    DROP POLICY IF EXISTS "Business owners can view their contracts" ON hr_contracts;
    DROP POLICY IF EXISTS "Business owners can create contracts" ON hr_contracts;
    DROP POLICY IF EXISTS "Business owners can update contracts" ON hr_contracts;

    EXECUTE '
    CREATE POLICY "Business owners can view their contracts"
      ON hr_contracts FOR SELECT
      USING (
        business_id IN (
          SELECT id FROM businesses WHERE created_by = auth.uid()
        )
        OR created_by = auth.uid()
      )';

    EXECUTE '
    CREATE POLICY "Business owners can create contracts"
      ON hr_contracts FOR INSERT
      WITH CHECK (
        business_id IN (
          SELECT id FROM businesses WHERE created_by = auth.uid()
        )
        OR created_by = auth.uid()
      )';

    EXECUTE '
    CREATE POLICY "Business owners can update contracts"
      ON hr_contracts FOR UPDATE
      USING (
        business_id IN (
          SELECT id FROM businesses WHERE created_by = auth.uid()
        )
        OR created_by = auth.uid()
      )';
  END IF;
END $$;

-- ============================================================================
-- STEP 7: CREATE PUBLIC ACCESS RLS POLICIES FOR PERSONAL INFO FORM
-- ============================================================================

-- Drop existing personal info policies if they exist
DROP POLICY IF EXISTS hr_contracts_personal_info_token_select ON hr_contracts;
DROP POLICY IF EXISTS hr_contracts_personal_info_token_update ON hr_contracts;
DROP POLICY IF EXISTS users_personal_info_token_select ON users;
DROP POLICY IF EXISTS users_personal_info_token_update ON users;
DROP POLICY IF EXISTS users_personal_info_token_insert ON users;

-- HR_CONTRACTS: Allow public SELECT by personal_info_token
CREATE POLICY hr_contracts_personal_info_token_select ON hr_contracts
FOR SELECT
USING (
  personal_info_token IS NOT NULL
);

-- HR_CONTRACTS: Allow public UPDATE by personal_info_token
CREATE POLICY hr_contracts_personal_info_token_update ON hr_contracts
FOR UPDATE
USING (
  personal_info_token IS NOT NULL
)
WITH CHECK (
  personal_info_token IS NOT NULL
);

-- USERS: Allow public SELECT by personal_info_token
CREATE POLICY users_personal_info_token_select ON users
FOR SELECT
USING (
  personal_info_token IS NOT NULL
);

-- USERS: Allow public UPDATE by personal_info_token
CREATE POLICY users_personal_info_token_update ON users
FOR UPDATE
USING (
  personal_info_token IS NOT NULL
)
WITH CHECK (
  personal_info_token IS NOT NULL
);

-- USERS: Allow public INSERT for new users (with validation)
CREATE POLICY users_personal_info_token_insert ON users
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM hr_contracts
    WHERE hr_contracts.employee_email = users.email
      AND hr_contracts.personal_info_token IS NOT NULL
  )
  OR
  personal_info_token IS NOT NULL
);

-- ============================================================================
-- STEP 8: ADD COMMENTS
-- ============================================================================

COMMENT ON POLICY hr_contracts_personal_info_token_select ON hr_contracts IS 'Public can view contracts by personal_info_token for personal info form (allows unauthenticated access)';
COMMENT ON POLICY hr_contracts_personal_info_token_update ON hr_contracts IS 'Public can update contracts by personal_info_token to mark form as submitted (allows unauthenticated access)';
COMMENT ON POLICY users_personal_info_token_select ON users IS 'Public can view user records by personal_info_token for personal info form pre-filling (allows unauthenticated access)';
COMMENT ON POLICY users_personal_info_token_update ON users IS 'Public can update user records by personal_info_token when submitting personal info form (allows unauthenticated access)';
COMMENT ON POLICY users_personal_info_token_insert ON users IS 'Public can insert user records when submitting personal info form for first time (allows unauthenticated access)';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify tables exist
SELECT 
    'TABLE CHECK' as check_type,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'hr_contracts')
        THEN '✅ hr_contracts table exists'
        ELSE '❌ hr_contracts table MISSING'
    END as status
UNION ALL
SELECT 
    'TABLE CHECK',
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users')
        THEN '✅ users table exists'
        ELSE '❌ users table MISSING'
    END;

-- Verify columns exist
SELECT 
    'COLUMN CHECK' as check_type,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'hr_contracts' AND column_name = 'personal_info_token')
        THEN '✅ hr_contracts.personal_info_token exists'
        ELSE '❌ hr_contracts.personal_info_token MISSING'
    END as status
UNION ALL
SELECT 
    'COLUMN CHECK',
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'personal_info_token')
        THEN '✅ users.personal_info_token exists'
        ELSE '❌ users.personal_info_token MISSING'
    END;

-- Verify RLS policies exist
SELECT 
    'RLS POLICY CHECK' as check_type,
    CASE 
        WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hr_contracts' AND policyname = 'hr_contracts_personal_info_token_select')
        THEN '✅ hr_contracts personal_info SELECT policy exists'
        ELSE '❌ hr_contracts personal_info SELECT policy MISSING'
    END as status
UNION ALL
SELECT 
    'RLS POLICY CHECK',
    CASE 
        WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'users_personal_info_token_select')
        THEN '✅ users personal_info SELECT policy exists'
        ELSE '❌ users personal_info SELECT policy MISSING'
    END;

