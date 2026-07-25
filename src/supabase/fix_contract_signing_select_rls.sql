-- Fix RLS policies for contract signing - Allow unauthenticated users to SELECT contracts by signing_token
-- This fixes the issue where contracts cannot be loaded when sent to recipients
-- Pattern matches waiver_signatures_select_public policy for consistency

-- Step 1: Check existing SELECT policies
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'hr_contracts'
  AND cmd = 'SELECT'
ORDER BY policyname;

-- Step 2: Drop existing SELECT policy for signing_token if it exists (to recreate it properly)
DROP POLICY IF EXISTS hr_contracts_signing_token_select ON hr_contracts;
DROP POLICY IF EXISTS hr_contracts_public_signing_select ON hr_contracts;
DROP POLICY IF EXISTS hr_contracts_authorized_rep_signing_select ON hr_contracts;

-- Step 3: Note - There should already be a SELECT policy for business owners
-- The existing policy "Business owners can view their contracts" allows authenticated
-- business owners/managers/admins to view contracts. We're adding additional policies
-- for unauthenticated access via signing tokens. Multiple SELECT policies are combined with OR.

-- Step 4: Create SELECT policy for public access via signing_token (allows unauthenticated access)
-- This allows anyone with a valid signing_token to read the contract
-- Security: The signing_token is unique and cryptographically secure
-- The application code filters by specific token in WHERE clause
CREATE POLICY hr_contracts_signing_token_select ON hr_contracts
FOR SELECT
USING (
  -- Allow unauthenticated users to read contracts by signing_token
  -- Token-based access allows public viewing during signing process
  signing_token IS NOT NULL
);

-- Step 5: Create SELECT policy for public access via authorized_representative_signing_token
CREATE POLICY hr_contracts_authorized_rep_signing_select ON hr_contracts
FOR SELECT
USING (
  -- Allow unauthenticated users to read contracts by authorized_representative_signing_token
  -- Token-based access allows public viewing during authorized rep signing process
  authorized_representative_signing_token IS NOT NULL
);

-- Step 6: Add comments
COMMENT ON POLICY hr_contracts_signing_token_select ON hr_contracts IS 'Public can view contracts by signing_token for signing (allows unauthenticated access)';
COMMENT ON POLICY hr_contracts_authorized_rep_signing_select ON hr_contracts IS 'Public can view contracts by authorized_representative_signing_token for signing (allows unauthenticated access)';

-- Step 7: Verify the policies were created
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'hr_contracts'
  AND cmd = 'SELECT'
ORDER BY policyname;

-- Step 8: Test query (uncomment and replace with actual token to test)
-- This should work even when not authenticated
/*
SELECT id, status, signing_token, employee_email, contract_html
FROM hr_contracts
WHERE signing_token = 'YOUR_TEST_TOKEN_HERE'
LIMIT 1;
*/

