-- Check ALL versions of update_user_personal_info_complete function
-- There might be multiple versions with different signatures causing conflicts

SELECT 
  p.oid,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as full_signature,
  pg_get_functiondef(p.oid) as function_definition,
  p.prosecdef as is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname LIKE '%personal_info%'
ORDER BY p.proname, p.oid;

-- Also check what RPC functions are currently exposed via PostgREST
-- This queries the PostgREST schema cache
SELECT 
  routine_name,
  routine_type,
  specific_name,
  data_type as return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE '%personal_info%'
ORDER BY routine_name;








