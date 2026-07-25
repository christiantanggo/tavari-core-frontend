-- Test if a specific personal_info_token exists in the database
-- Replace 'YOUR_TOKEN_HERE' with the actual token you're testing

-- Test token from console: f3498a00-c2b4-4255-9660-75a448b95031

-- ============================================================================
-- CHECK IF TOKEN EXISTS IN USERS TABLE
-- ============================================================================

SELECT 
    'USER TOKEN CHECK' as check_type,
    id,
    email,
    first_name,
    last_name,
    personal_info_token,
    CASE 
        WHEN personal_info_token IS NOT NULL THEN '✅ Token exists'
        ELSE '❌ No token'
    END as status
FROM users
WHERE personal_info_token = 'f3498a00-c2b4-4255-9660-75a448b95031';

-- ============================================================================
-- CHECK IF TOKEN EXISTS IN HR_CONTRACTS TABLE
-- ============================================================================

SELECT 
    'CONTRACT TOKEN CHECK' as check_type,
    id,
    employee_email,
    employee_first_name,
    employee_last_name,
    personal_info_token,
    personal_info_submitted_at,
    CASE 
        WHEN personal_info_token IS NOT NULL THEN '✅ Token exists'
        ELSE '❌ No token'
    END as status
FROM hr_contracts
WHERE personal_info_token = 'f3498a00-c2b4-4255-9660-75a448b95031';

-- ============================================================================
-- TEST RPC FUNCTION DIRECTLY
-- ============================================================================

-- Test user RPC function
SELECT * FROM get_user_by_personal_info_token('f3498a00-c2b4-4255-9660-75a448b95031');

-- Test contract RPC function
SELECT * FROM get_contract_by_personal_info_token('f3498a00-c2b4-4255-9660-75a448b95031');

-- ============================================================================
-- CHECK ALL TOKENS (for debugging)
-- ============================================================================

SELECT 
    'ALL USER TOKENS' as check_type,
    COUNT(*) as total_users_with_tokens
FROM users
WHERE personal_info_token IS NOT NULL;

SELECT 
    'ALL CONTRACT TOKENS' as check_type,
    COUNT(*) as total_contracts_with_tokens
FROM hr_contracts
WHERE personal_info_token IS NOT NULL;












