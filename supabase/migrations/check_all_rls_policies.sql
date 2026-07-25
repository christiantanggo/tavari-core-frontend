-- Check ALL RLS policies on hr_contracts and users tables
-- This helps identify if there are conflicting policies blocking access

-- ============================================================================
-- ALL POLICIES ON HR_CONTRACTS
-- ============================================================================

SELECT 
    'HR_CONTRACTS POLICIES' as section,
    policyname,
    permissive,
    roles,
    cmd as command,
    qual as using_expression,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'hr_contracts'
ORDER BY cmd, policyname;

-- ============================================================================
-- ALL POLICIES ON USERS
-- ============================================================================

SELECT 
    'USERS POLICIES' as section,
    policyname,
    permissive,
    roles,
    cmd as command,
    qual as using_expression,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'users'
ORDER BY cmd, policyname;

-- ============================================================================
-- CHECK IF RLS IS ENABLED
-- ============================================================================

SELECT 
    'RLS STATUS' as section,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('hr_contracts', 'users')
ORDER BY tablename;

-- ============================================================================
-- TEST QUERY (uncomment and replace token to test)
-- ============================================================================
-- This simulates what the form is trying to do
/*
-- Test as unauthenticated user (this should work if policies are correct)
SELECT id, employee_email, personal_info_token 
FROM hr_contracts 
WHERE personal_info_token = 'YOUR_TEST_TOKEN_HERE'
LIMIT 1;

SELECT id, email, first_name, last_name, personal_info_token 
FROM users 
WHERE personal_info_token = 'YOUR_TEST_TOKEN_HERE'
LIMIT 1;
*/
















