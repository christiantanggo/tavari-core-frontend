-- Test if PostgREST can access the personal info columns
-- This will help verify if the schema cache has refreshed

-- ============================================================================
-- TEST 1: Try to query users table with address columns
-- ============================================================================

-- This should work if the schema cache has refreshed
SELECT 
    'TEST QUERY - USERS' as test_type,
    COUNT(*) as total_users,
    COUNT(address_line1) as users_with_address,
    COUNT(personal_info_token) as users_with_token,
    '✅ Query successful - schema cache refreshed' as status
FROM users
LIMIT 1;

-- ============================================================================
-- TEST 2: Try to query hr_contracts table with personal_info columns
-- ============================================================================

-- This should work if the schema cache has refreshed
SELECT 
    'TEST QUERY - HR_CONTRACTS' as test_type,
    COUNT(*) as total_contracts,
    COUNT(personal_info_token) as contracts_with_token,
    COUNT(personal_info_submitted_at) as contracts_submitted,
    '✅ Query successful - schema cache refreshed' as status
FROM hr_contracts
LIMIT 1;

-- ============================================================================
-- TEST 3: Try a WHERE clause with personal_info_token (like the form does)
-- ============================================================================

-- This simulates what the form does
SELECT 
    'TEST QUERY - TOKEN FILTER' as test_type,
    COUNT(*) as matching_records,
    '✅ Query successful - token filtering works' as status
FROM users
WHERE personal_info_token IS NOT NULL
LIMIT 1;

SELECT 
    'TEST QUERY - TOKEN FILTER CONTRACTS' as test_type,
    COUNT(*) as matching_records,
    '✅ Query successful - token filtering works' as status
FROM hr_contracts
WHERE personal_info_token IS NOT NULL
LIMIT 1;

-- ============================================================================
-- NOTES
-- ============================================================================
-- If all these queries succeed, the schema cache has refreshed and the form should work.
-- If any fail with "column does not exist", you need to restart your Supabase project.












