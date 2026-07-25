-- Delete everything related to accounting@tanggo.ca and hr@tanggo.ca
-- This will delete the users, contracts, and all related records
-- Run this carefully!

BEGIN;

DO $$
DECLARE
  target_emails TEXT[] := ARRAY['accounting@tanggo.ca', 'hr@tanggo.ca'];
  target_email TEXT;
  target_user_id UUID;
  deleted_contracts_count INT := 0;
  deleted_business_users_count INT := 0;
  deleted_user_roles_count INT := 0;
  total_contracts_deleted INT := 0;
  total_business_users_deleted INT := 0;
  total_user_roles_deleted INT := 0;
BEGIN
  -- Loop through each email
  FOREACH target_email IN ARRAY target_emails
  LOOP
    RAISE NOTICE 'Processing email: %', target_email;
    
    -- Find the user ID
    SELECT id INTO target_user_id
    FROM public.users
    WHERE email = LOWER(TRIM(target_email));
    
    IF target_user_id IS NULL THEN
      RAISE NOTICE 'User with email % not found in public.users', target_email;
    ELSE
      RAISE NOTICE 'Found user ID: %', target_user_id;
      
      -- Delete from business_users
      DELETE FROM public.business_users
      WHERE user_id = target_user_id;
      GET DIAGNOSTICS deleted_business_users_count = ROW_COUNT;
      total_business_users_deleted := total_business_users_deleted + deleted_business_users_count;
      RAISE NOTICE 'Deleted % business_users entries for %', deleted_business_users_count, target_email;
      
      -- Delete from user_roles
      DELETE FROM public.user_roles
      WHERE user_id = target_user_id;
      GET DIAGNOSTICS deleted_user_roles_count = ROW_COUNT;
      total_user_roles_deleted := total_user_roles_deleted + deleted_user_roles_count;
      RAISE NOTICE 'Deleted % user_roles entries for %', deleted_user_roles_count, target_email;
      
      -- Update hr_contracts to clear employee_id (don't delete contracts, just unlink)
      UPDATE public.hr_contracts
      SET employee_id = NULL
      WHERE employee_id = target_user_id;
      RAISE NOTICE 'Cleared employee_id from hr_contracts for %', target_email;
      
      -- Delete from public.users
      DELETE FROM public.users
      WHERE id = target_user_id;
      RAISE NOTICE 'Deleted from public.users for %', target_email;
      
      -- Delete from auth.users (Supabase Auth)
      DELETE FROM auth.users
      WHERE id = target_user_id;
      RAISE NOTICE 'Deleted from auth.users for %', target_email;
    END IF;
    
    -- Delete all contracts for this email
    DELETE FROM public.hr_contracts
    WHERE employee_email = LOWER(TRIM(target_email));
    GET DIAGNOSTICS deleted_contracts_count = ROW_COUNT;
    total_contracts_deleted := total_contracts_deleted + deleted_contracts_count;
    RAISE NOTICE 'Deleted % contracts for email %', deleted_contracts_count, target_email;
  END LOOP;
  
  RAISE NOTICE '========== CLEANUP SUMMARY ==========';
  RAISE NOTICE 'Total contracts deleted: %', total_contracts_deleted;
  RAISE NOTICE 'Total business_users deleted: %', total_business_users_deleted;
  RAISE NOTICE 'Total user_roles deleted: %', total_user_roles_deleted;
  RAISE NOTICE 'Cleanup complete!';
END $$;

-- Verify deletion
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM public.users WHERE email IN ('accounting@tanggo.ca', 'hr@tanggo.ca')) 
    THEN 'ERROR: Users still exist'
    WHEN EXISTS (SELECT 1 FROM public.hr_contracts WHERE employee_email IN ('accounting@tanggo.ca', 'hr@tanggo.ca'))
    THEN 'ERROR: Contracts still exist'
    ELSE 'SUCCESS: All records deleted ✓'
  END as deletion_status;

-- Show summary
SELECT 
  'Summary' as info,
  (SELECT COUNT(*) FROM public.users WHERE email IN ('accounting@tanggo.ca', 'hr@tanggo.ca')) as remaining_users,
  (SELECT COUNT(*) FROM public.hr_contracts WHERE employee_email IN ('accounting@tanggo.ca', 'hr@tanggo.ca')) as remaining_contracts,
  (SELECT COUNT(*) FROM public.business_users bu 
   JOIN public.users u ON bu.user_id = u.id 
   WHERE u.email IN ('accounting@tanggo.ca', 'hr@tanggo.ca')) as remaining_business_users;

COMMIT;








