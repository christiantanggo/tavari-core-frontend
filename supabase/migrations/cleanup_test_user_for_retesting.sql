-- Cleanup script to delete a test user and allow retesting with the same email
-- Replace 'test@example.com' with the email you want to clean up

DO $$
DECLARE
  v_email TEXT := 'test@example.com'; -- CHANGE THIS EMAIL
  v_user_id UUID;
  v_auth_user_id UUID;
  v_contract_ids UUID[];
BEGIN
  -- Find the user in public.users
  SELECT id INTO v_user_id
  FROM public.users
  WHERE email = LOWER(TRIM(v_email));
  
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User not found in public.users: %', v_email;
  ELSE
    RAISE NOTICE 'Found user in public.users: % (ID: %)', v_email, v_user_id;
    
    -- Find auth user by email
    SELECT id INTO v_auth_user_id
    FROM auth.users
    WHERE email = LOWER(TRIM(v_email));
    
    IF v_auth_user_id IS NOT NULL THEN
      RAISE NOTICE 'Found auth user: % (ID: %)', v_email, v_auth_user_id;
    END IF;
    
    -- Get all contract IDs for this user
    SELECT ARRAY_AGG(id) INTO v_contract_ids
    FROM hr_contracts
    WHERE employee_email = LOWER(TRIM(v_email));
    
    -- Delete in correct order (respecting foreign keys)
    RAISE NOTICE 'Deleting user_roles...';
    DELETE FROM public.user_roles WHERE user_id = v_user_id;
    
    RAISE NOTICE 'Deleting business_users...';
    DELETE FROM public.business_users WHERE user_id = v_user_id OR user_id = v_auth_user_id;
    
    RAISE NOTICE 'Deleting hr_contracts...';
    DELETE FROM public.hr_contracts WHERE employee_email = LOWER(TRIM(v_email));
    
    RAISE NOTICE 'Deleting from public.users...';
    DELETE FROM public.users WHERE id = v_user_id;
    
    -- Delete from auth.users (requires admin privileges)
    IF v_auth_user_id IS NOT NULL THEN
      RAISE NOTICE 'Deleting from auth.users...';
      DELETE FROM auth.users WHERE id = v_auth_user_id;
    END IF;
    
    RAISE NOTICE '✅ Cleanup complete for: %', v_email;
    RAISE NOTICE '   - Deleted user_roles';
    RAISE NOTICE '   - Deleted business_users';
    RAISE NOTICE '   - Deleted hr_contracts';
    RAISE NOTICE '   - Deleted public.users';
    IF v_auth_user_id IS NOT NULL THEN
      RAISE NOTICE '   - Deleted auth.users';
    END IF;
  END IF;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error during cleanup: %', SQLERRM;
    RAISE;
END $$;

-- Verify deletion
SELECT 
  'public.users' as table_name,
  COUNT(*) as remaining_records
FROM public.users
WHERE email = LOWER(TRIM('test@example.com')) -- CHANGE THIS EMAIL
UNION ALL
SELECT 
  'auth.users' as table_name,
  COUNT(*) as remaining_records
FROM auth.users
WHERE email = LOWER(TRIM('test@example.com')) -- CHANGE THIS EMAIL
UNION ALL
SELECT 
  'business_users' as table_name,
  COUNT(*) as remaining_records
FROM public.business_users bu
JOIN public.users u ON bu.user_id = u.id
WHERE u.email = LOWER(TRIM('test@example.com')) -- CHANGE THIS EMAIL
UNION ALL
SELECT 
  'user_roles' as table_name,
  COUNT(*) as remaining_records
FROM public.user_roles ur
JOIN public.users u ON ur.user_id = u.id
WHERE u.email = LOWER(TRIM('test@example.com')) -- CHANGE THIS EMAIL
UNION ALL
SELECT 
  'hr_contracts' as table_name,
  COUNT(*) as remaining_records
FROM public.hr_contracts
WHERE employee_email = LOWER(TRIM('test@example.com')); -- CHANGE THIS EMAIL








