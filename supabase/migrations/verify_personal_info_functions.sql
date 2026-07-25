-- Verify that the personal info functions exist and are accessible
-- Run this to check if PostgREST can see the functions

-- Check if functions exist
SELECT 
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  p.provolatile as volatility,
  p.prosecdef as security_definer
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN ('create_user_from_personal_info_token', 'update_user_personal_info_complete')
ORDER BY p.proname;

-- Check grants
SELECT 
  routine_name,
  routine_type,
  data_type as return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('create_user_from_personal_info_token', 'update_user_personal_info_complete');

-- Try to call the function directly (this will fail if there's a permission issue, but will show the function exists)
-- DO NOT RUN THIS - it's just for reference
-- SELECT update_user_personal_info_complete(
--   'test-token',
--   'test@example.com',
--   'Test',
--   'User',
--   '123456789',
--   '1990-01-01'::date,
--   '123 Main St',
--   '',
--   'Toronto',
--   'ON',
--   'M1M1M1',
--   '555-1234',
--   'Emergency Contact',
--   '555-5678',
--   'Parent',
--   NULL,
--   NULL,
--   NULL
-- );








