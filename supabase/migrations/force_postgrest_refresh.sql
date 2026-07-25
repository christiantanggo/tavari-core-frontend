-- Force PostgREST to completely refresh its schema cache
-- This is more aggressive than the simple NOTIFY

-- Method 1: Multiple NOTIFY calls
SELECT pg_notify('pgrst', 'reload schema');
SELECT pg_notify('pgrst', 'reload schema');
SELECT pg_notify('pgrst', 'reload schema');

-- Method 2: Using DO block
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
  PERFORM pg_notify('pgrst', 'reload schema');
  PERFORM pg_notify('pgrst', 'reload schema');
END $$;

-- Method 3: Verify functions are in public schema and accessible
SELECT 
  'Function exists: ' || proname as status,
  proname,
  pg_get_function_identity_arguments(oid) as signature
FROM pg_proc
WHERE proname IN ('create_user_from_personal_info_token', 'update_user_personal_info_complete')
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- Method 4: Check if functions are exposed to PostgREST
-- PostgREST should automatically see functions in the public schema with EXECUTE grants
SELECT 
  routine_name,
  routine_schema,
  'EXECUTE grant exists' as grant_status
FROM information_schema.routines r
WHERE routine_schema = 'public'
  AND routine_name IN ('create_user_from_personal_info_token', 'update_user_personal_info_complete')
  AND EXISTS (
    SELECT 1 
    FROM information_schema.routine_privileges rp
    WHERE rp.routine_schema = r.routine_schema
      AND rp.routine_name = r.routine_name
      AND rp.privilege_type = 'EXECUTE'
  );








