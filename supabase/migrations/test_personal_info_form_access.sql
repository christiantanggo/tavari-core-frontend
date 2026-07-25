-- Test script to verify personal info form access works
-- This helps diagnose RLS policy issues

-- ============================================================================
-- TEST 1: Check if columns are accessible (without RLS)
-- ============================================================================

-- Test querying the columns directly
SELECT 
    'COLUMN ACCESS TEST' as test_name,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'hr_contracts' 
            AND column_name = 'personal_info_token'
        )
        THEN '✅ Column exists and is queryable'
        ELSE '❌ Column not found'
    END as hr_contracts_token_status,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'users' 
            AND column_name = 'personal_info_token'
        )
        THEN '✅ Column exists and is queryable'
        ELSE '❌ Column not found'
    END as users_token_status;

-- ============================================================================
-- TEST 2: Check RLS is enabled
-- ============================================================================

SELECT 
    'RLS STATUS' as test_name,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('hr_contracts', 'users')
ORDER BY tablename;

-- ============================================================================
-- TEST 3: List all RLS policies for personal_info_token
-- ============================================================================

SELECT 
    'RLS POLICIES' as test_name,
    tablename,
    policyname,
    cmd as command,
    CASE 
        WHEN qual LIKE '%personal_info_token%' THEN '✅ Uses personal_info_token'
        ELSE '⚠️ Does not use personal_info_token'
    END as token_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (tablename = 'hr_contracts' AND policyname LIKE '%personal_info%')
    OR (tablename = 'users' AND policyname LIKE '%personal_info%')
  )
ORDER BY tablename, policyname;

-- ============================================================================
-- TEST 4: Check if we can see policies that allow public access
-- ============================================================================

SELECT 
    'PUBLIC ACCESS POLICIES' as test_name,
    tablename,
    policyname,
    cmd as command,
    qual as using_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (tablename = 'hr_contracts' AND policyname LIKE '%personal_info%')
    OR (tablename = 'users' AND policyname LIKE '%personal_info%')
  )
ORDER BY tablename, cmd, policyname;

-- ============================================================================
-- TEST 5: Try to find a sample token to test with
-- ============================================================================

-- Check if there are any contracts with personal_info_token set
SELECT 
    'SAMPLE DATA CHECK' as test_name,
    COUNT(*) as contracts_with_token,
    COUNT(DISTINCT personal_info_token) as unique_tokens
FROM hr_contracts
WHERE personal_info_token IS NOT NULL;

-- Check if there are any users with personal_info_token set
SELECT 
    'SAMPLE DATA CHECK' as test_name,
    COUNT(*) as users_with_token,
    COUNT(DISTINCT personal_info_token) as unique_tokens
FROM users
WHERE personal_info_token IS NOT NULL;

-- ============================================================================
-- TEST 6: Verify the exact policy expressions
-- ============================================================================

SELECT 
    'POLICY DETAILS' as test_name,
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (tablename = 'hr_contracts' AND policyname LIKE '%personal_info%')
    OR (tablename = 'users' AND policyname LIKE '%personal_info%')
  )
ORDER BY tablename, cmd, policyname;

-- ============================================================================
-- RECOMMENDATION
-- ============================================================================
-- If policies exist but queries still fail with 400 errors, it might be:
-- 1. Schema cache issue - try refreshing Supabase dashboard
-- 2. RLS policy expression issue - check the qual expressions above
-- 3. Missing permissions - policies might not be permissive correctly
-- 
-- To test manually (as unauthenticated user):
-- SELECT id, employee_email, personal_info_token 
-- FROM hr_contracts 
-- WHERE personal_info_token = 'YOUR_TEST_TOKEN_HERE'
-- LIMIT 1;
















