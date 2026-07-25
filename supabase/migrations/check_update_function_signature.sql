-- Check the EXACT signature of update_user_personal_info function

SELECT 
    'FUNCTION SIGNATURE' as check_type,
    p.proname as function_name,
    pg_get_function_arguments(p.oid) as arguments,
    pg_get_function_result(p.oid) as return_type,
    p.oid
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'update_user_personal_info';

-- Check parameters in detail
SELECT 
    'FUNCTION PARAMETERS' as check_type,
    p.proname as function_name,
    unnest(p.proargnames) as parameter_name,
    unnest(p.proargtypes::regtype[]) as parameter_type,
    generate_subscripts(p.proargtypes, 1) as parameter_position
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'update_user_personal_info'
ORDER BY parameter_position;












