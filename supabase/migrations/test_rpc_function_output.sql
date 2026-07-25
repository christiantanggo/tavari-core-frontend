-- Test what the RPC function actually returns
-- Replace the token with the one you're testing

-- Test with a token that exists
SELECT * FROM get_user_by_personal_info_token('10c535f2-3353-4d00-bfa6-45a6d9c1713f');

-- Check function return type
SELECT 
    p.proname as function_name,
    pg_get_function_result(p.oid) as return_type
FROM pg_proc p
WHERE p.proname = 'get_user_by_personal_info_token';

