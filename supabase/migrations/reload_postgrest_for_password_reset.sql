-- Force PostgREST to reload schema to pick up new password reset functions
NOTIFY pgrst, 'reload schema';

-- Verify the function is accessible
SELECT 
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'request_password_reset'
  AND n.nspname = 'public';








