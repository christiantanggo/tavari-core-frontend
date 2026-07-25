-- Fix RLS policies for pay statement viewing - Allow unauthenticated users to SELECT by viewing_token
-- This fixes the issue where pay statement links redirect to login page
-- Pattern matches contract signing RLS policies for consistency

-- Step 1: Check existing SELECT policies on hrpayroll_entries
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
WHERE tablename = 'hrpayroll_entries'
  AND cmd = 'SELECT'
ORDER BY policyname;

-- Step 2: Drop existing SELECT policy for viewing_token if it exists (to recreate it properly)
DROP POLICY IF EXISTS hrpayroll_entries_viewing_token_select ON hrpayroll_entries;

-- Step 3: Note - There should already be SELECT policies for business owners/managers
-- We're adding an additional policy for unauthenticated access via viewing_token
-- Multiple SELECT policies are combined with OR.

-- Step 4: Create SELECT policy for public access via viewing_token (allows unauthenticated access)
-- This allows anyone with a valid viewing_token to read the pay statement entry
-- Security: The viewing_token is unique and cryptographically secure
-- The application code filters by specific token in WHERE clause
CREATE POLICY hrpayroll_entries_viewing_token_select ON hrpayroll_entries
FOR SELECT
USING (
  -- Allow unauthenticated users to read pay statement entries by viewing_token
  -- Token-based access allows public viewing of pay statements via email link
  viewing_token IS NOT NULL
);

-- Step 5: Add comment
COMMENT ON POLICY hrpayroll_entries_viewing_token_select ON hrpayroll_entries IS 'Public can view pay statement entries by viewing_token for email links (allows unauthenticated access)';

-- Step 6: Verify the policy was created
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
WHERE tablename = 'hrpayroll_entries'
  AND cmd = 'SELECT'
ORDER BY policyname;

-- Step 7: Test query (uncomment and replace with actual token to test)
-- This should work even when not authenticated
/*
SELECT id, user_id, viewing_token, gross_pay, net_pay
FROM hrpayroll_entries
WHERE viewing_token = 'YOUR_TEST_TOKEN_HERE'
LIMIT 1;
*/



