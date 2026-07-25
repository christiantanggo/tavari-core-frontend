-- Check the current definition of update_user_personal_info_complete function
-- This will show what version is actually in the database

-- Get the function definition
SELECT 
  p.proname as function_name,
  pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'update_user_personal_info_complete';

-- Alternative: Get just the function signature and basic info
SELECT 
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as return_type,
  p.prosrc as function_source_code
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'update_user_personal_info_complete';

-- Check if function exists at all
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.proname = 'update_user_personal_info_complete'
    )
    THEN 'Function EXISTS'
    ELSE 'Function DOES NOT EXIST'
  END as function_status;








