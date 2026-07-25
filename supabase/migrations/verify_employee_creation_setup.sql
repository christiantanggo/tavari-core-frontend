-- Verify that employee creation flow is properly set up

-- 1. Check if RPC function has p_user_id parameter
SELECT 
  'RPC Function Check' as check_type,
  CASE 
    WHEN pg_get_function_arguments(p.oid) LIKE '%p_user_id%' 
    THEN '✅ RPC function has p_user_id parameter'
    ELSE '❌ RPC function MISSING p_user_id parameter - run migration!'
  END as status,
  pg_get_function_arguments(p.oid) as function_signature
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'create_employee_from_contract_rpc';

-- 2. Check if edge function exists (can't verify from SQL, but document it)
SELECT 
  'Edge Function' as check_type,
  '⚠️ Verify create-employee-auth edge function is deployed' as status,
  'Check Supabase Dashboard > Edge Functions' as note;

-- 3. Check grants on RPC function
SELECT 
  'RPC Permissions' as check_type,
  acl.privilege_type,
  CASE 
    WHEN acl.grantee = 0 THEN 'PUBLIC (all roles)'
    ELSE COALESCE(r.rolname, 'role_oid_' || acl.grantee::text)
  END as grantee_name
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.pronamespace))) acl ON true
LEFT JOIN pg_roles r ON r.oid = acl.grantee
WHERE n.nspname = 'public'
  AND p.proname = 'create_employee_from_contract_rpc'
  AND acl.privilege_type = 'EXECUTE';








