-- Diagnostic query to check if update_user_personal_info_complete function exists and has proper permissions

-- 1. Check if function exists
SELECT 
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as function_signature,
  p.prosecdef as is_security_definer,
  p.proacl as access_privileges
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'update_user_personal_info_complete'
ORDER BY p.proname;

-- 2. Check function parameters (simpler version)
SELECT 
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as all_arguments,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  array_length(p.proargnames, 1) as parameter_count
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'update_user_personal_info_complete';

-- 3. Check grants (what roles can execute)
SELECT 
  p.proname as function_name,
  acl.privilege_type,
  acl.grantee
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.pronamespace))) acl ON true
WHERE n.nspname = 'public'
  AND p.proname = 'update_user_personal_info_complete';

-- 4. Check if function is callable (simpler check)
SELECT 
  routine_name,
  routine_type,
  data_type as return_type,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'update_user_personal_info_complete';

-- 5. Test if we can call it (should return an error with parameter info if function exists)
-- This will help us see the exact signature expected
DO $$
BEGIN
  PERFORM update_user_personal_info_complete(
    NULL::TEXT, -- token_param
    NULL::TEXT, -- p_email
    NULL::TEXT, -- p_first_name
    NULL::TEXT, -- p_last_name
    NULL::TEXT, -- p_sin
    NULL::DATE, -- p_birth_date
    NULL::TEXT, -- p_address_line1
    NULL::TEXT, -- p_address_line2
    NULL::TEXT, -- p_address_city
    NULL::TEXT, -- p_address_state
    NULL::TEXT, -- p_address_postal_code
    NULL::TEXT, -- p_phone
    NULL::TEXT, -- p_emergency_contact_name
    NULL::TEXT, -- p_emergency_contact_phone
    NULL::TEXT, -- p_emergency_contact_relationship
    NULL::TEXT, -- p_hashed_password
    NULL::TEXT, -- p_hashed_pin
    NULL::UUID  -- p_business_id
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Function exists but call failed (expected): %', SQLERRM;
END $$;

