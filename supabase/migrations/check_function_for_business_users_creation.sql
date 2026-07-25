-- Check if the UPDATE function contains the business_users creation logic
-- This searches the function source code for key indicators

SELECT 
  p.proname as function_name,
  CASE 
    WHEN p.prosrc LIKE '%business_users%' THEN '✅ Contains business_users logic'
    ELSE '❌ Missing business_users logic'
  END as has_business_users_logic,
  CASE 
    WHEN p.prosrc LIKE '%hashed_password%' AND p.prosrc LIKE '%pin%' THEN '✅ Has correct column names (hashed_password, pin)'
    WHEN p.prosrc LIKE '%password_hash%' OR p.prosrc LIKE '%pin_hash%' THEN '❌ Has OLD column names (password_hash, pin_hash)'
    ELSE '⚠️ Cannot determine column names'
  END as column_names_status,
  CASE 
    WHEN p.prosrc LIKE '%INSERT INTO public.business_users%' THEN '✅ Has INSERT statement for business_users'
    ELSE '❌ Missing INSERT statement for business_users'
  END as has_insert_statement,
  LENGTH(p.prosrc) as function_length,
  p.prosrc as full_function_code
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'update_user_personal_info_complete';








