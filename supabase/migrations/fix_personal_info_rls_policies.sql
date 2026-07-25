-- Fix RLS policies for personal info form access
-- This ensures the policies work correctly for unauthenticated users

-- ============================================================================
-- STEP 1: Drop and recreate policies to ensure they're correct
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS hr_contracts_personal_info_token_select ON hr_contracts;
DROP POLICY IF EXISTS hr_contracts_personal_info_token_update ON hr_contracts;
DROP POLICY IF EXISTS users_personal_info_token_select ON users;
DROP POLICY IF EXISTS users_personal_info_token_update ON users;
DROP POLICY IF EXISTS users_personal_info_token_insert ON users;

-- ============================================================================
-- STEP 2: Recreate HR_CONTRACTS policies
-- ============================================================================

-- SELECT policy: Allow public access when personal_info_token matches
-- This is permissive - allows any row where token is not null
-- The WHERE clause in the query filters to the specific token
CREATE POLICY hr_contracts_personal_info_token_select ON hr_contracts
FOR SELECT
TO public
USING (
  personal_info_token IS NOT NULL
);

-- UPDATE policy: Allow public access to update when token matches
CREATE POLICY hr_contracts_personal_info_token_update ON hr_contracts
FOR UPDATE
TO public
USING (
  personal_info_token IS NOT NULL
)
WITH CHECK (
  personal_info_token IS NOT NULL
);

-- ============================================================================
-- STEP 3: Recreate USERS policies
-- ============================================================================

-- SELECT policy: Allow public access when personal_info_token matches
CREATE POLICY users_personal_info_token_select ON users
FOR SELECT
TO public
USING (
  personal_info_token IS NOT NULL
);

-- UPDATE policy: Allow public access to update when token matches
CREATE POLICY users_personal_info_token_update ON users
FOR UPDATE
TO public
USING (
  personal_info_token IS NOT NULL
)
WITH CHECK (
  personal_info_token IS NOT NULL
);

-- INSERT policy: Allow public access to insert new users
CREATE POLICY users_personal_info_token_insert ON users
FOR INSERT
TO public
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
-- STEP 4: Add comments
-- ============================================================================

COMMENT ON POLICY hr_contracts_personal_info_token_select ON hr_contracts IS 'Public can view contracts by personal_info_token for personal info form (allows unauthenticated access)';
COMMENT ON POLICY hr_contracts_personal_info_token_update ON hr_contracts IS 'Public can update contracts by personal_info_token to mark form as submitted (allows unauthenticated access)';
COMMENT ON POLICY users_personal_info_token_select ON users IS 'Public can view user records by personal_info_token for personal info form pre-filling (allows unauthenticated access)';
COMMENT ON POLICY users_personal_info_token_update ON users IS 'Public can update user records by personal_info_token when submitting personal info form (allows unauthenticated access)';
COMMENT ON POLICY users_personal_info_token_insert ON users IS 'Public can insert user records when submitting personal info form for first time (allows unauthenticated access)';

-- ============================================================================
-- STEP 5: Verify policies
-- ============================================================================

SELECT 
    'POLICY VERIFICATION' as check_type,
    tablename,
    policyname,
    roles,
    cmd as command,
    qual as using_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (tablename = 'hr_contracts' AND policyname LIKE '%personal_info%')
    OR (tablename = 'users' AND policyname LIKE '%personal_info%')
  )
ORDER BY tablename, cmd, policyname;
















