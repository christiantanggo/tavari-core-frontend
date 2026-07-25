-- Check what roles can execute the function (with role names)

SELECT 
  p.proname as function_name,
  acl.privilege_type,
  CASE 
    WHEN acl.grantee = 0 THEN 'PUBLIC (all roles)'
    ELSE COALESCE(r.rolname, 'role_oid_' || acl.grantee::text)
  END as grantee_name,
  acl.grantee as grantee_oid
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.pronamespace))) acl ON true
LEFT JOIN pg_roles r ON r.oid = acl.grantee
WHERE n.nspname = 'public'
  AND p.proname = 'update_user_personal_info_complete'
ORDER BY 
  CASE WHEN acl.grantee = 0 THEN 0 ELSE 1 END,
  acl.grantee;

-- Also check what roles exist in the system
SELECT 
  rolname,
  oid
FROM pg_roles
WHERE rolname IN ('authenticated', 'anon', 'public', 'postgres', 'service_role')
ORDER BY rolname;








