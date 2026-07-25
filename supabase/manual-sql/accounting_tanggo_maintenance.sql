-- Manual maintenance SQL for accounting@tanggo.ca.
-- These scripts were moved out of supabase/migrations because they are
-- environment-specific operational utilities and must not run during db reset/push.

-- ============================================================================
-- Original: clear_accounting_password.sql
-- ============================================================================
-- Clear password and PIN for accounting@tanggo.ca so they can use first-time login flow
UPDATE users
SET
  hashed_password = NULL,
  pin = NULL,
  updated_at = NOW()
WHERE email = 'accounting@tanggo.ca';

-- Verify it was cleared
SELECT
  id,
  email,
  hashed_password IS NULL as password_cleared,
  pin IS NULL as pin_cleared
FROM users
WHERE email = 'accounting@tanggo.ca';

-- ============================================================================
-- Original: delete_all_accounting_tanggo.sql
-- ============================================================================
-- Delete everything related to accounting@tanggo.ca
-- This will delete the user, contracts, and all related records
-- Run this carefully!

BEGIN;

DO $$
DECLARE
  target_email TEXT := 'accounting@tanggo.ca';
  target_user_id UUID;
  deleted_contracts_count INT := 0;
  deleted_business_users_count INT := 0;
  deleted_user_roles_count INT := 0;
BEGIN
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
    RAISE NOTICE 'Deleted % business_users entries', deleted_business_users_count;

    -- Delete from user_roles
    DELETE FROM public.user_roles
    WHERE user_id = target_user_id;
    GET DIAGNOSTICS deleted_user_roles_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % user_roles entries', deleted_user_roles_count;

    -- Update hr_contracts to clear employee_id (don't delete contracts, just unlink)
    UPDATE public.hr_contracts
    SET employee_id = NULL
    WHERE employee_id = target_user_id;
    RAISE NOTICE 'Cleared employee_id from hr_contracts';

    -- Delete from public.users
    DELETE FROM public.users
    WHERE id = target_user_id;
    RAISE NOTICE 'Deleted from public.users';

    -- Delete from auth.users (Supabase Auth)
    DELETE FROM auth.users
    WHERE id = target_user_id;
    RAISE NOTICE 'Deleted from auth.users';
  END IF;

  -- Delete all contracts for this email
  DELETE FROM public.hr_contracts
  WHERE employee_email = LOWER(TRIM(target_email));
  GET DIAGNOSTICS deleted_contracts_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % contracts for email %', deleted_contracts_count, target_email;

  RAISE NOTICE 'Cleanup complete!';
END $$;

-- Verify deletion
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM public.users WHERE email = 'accounting@tanggo.ca')
    THEN 'ERROR: User still exists'
    WHEN EXISTS (SELECT 1 FROM public.hr_contracts WHERE employee_email = 'accounting@tanggo.ca')
    THEN 'ERROR: Contracts still exist'
    ELSE 'SUCCESS: All records deleted ✓'
  END as deletion_status;

-- Show summary
SELECT
  'Summary' as info,
  (SELECT COUNT(*) FROM public.users WHERE email = 'accounting@tanggo.ca') as remaining_users,
  (SELECT COUNT(*) FROM public.hr_contracts WHERE employee_email = 'accounting@tanggo.ca') as remaining_contracts,
  (SELECT COUNT(*) FROM public.business_users bu
   JOIN public.users u ON bu.user_id = u.id
   WHERE u.email = 'accounting@tanggo.ca') as remaining_business_users;

COMMIT;

-- ============================================================================
-- Original: delete_accounting_tanggo.sql
-- ============================================================================
-- Delete everything related to accounting@tanggo.ca
-- This will delete the user, contracts, and all related records
-- Run this carefully!

BEGIN;

DO $$
DECLARE
  target_email TEXT := 'accounting@tanggo.ca';
  target_user_id UUID;
  deleted_contracts_count INT := 0;
  deleted_business_users_count INT := 0;
  deleted_user_roles_count INT := 0;
BEGIN
  RAISE NOTICE 'Processing email: %', target_email;

  -- Find the user ID (check both public.users and auth.users)
  SELECT id INTO target_user_id
  FROM public.users
  WHERE email = LOWER(TRIM(target_email));

  IF target_user_id IS NULL THEN
    RAISE NOTICE 'User with email % not found in public.users', target_email;

    -- Try to find in auth.users
    SELECT id INTO target_user_id
    FROM auth.users
    WHERE email = LOWER(TRIM(target_email));

    IF target_user_id IS NULL THEN
      RAISE NOTICE 'User with email % not found in auth.users either', target_email;
    ELSE
      RAISE NOTICE 'Found user ID in auth.users: %', target_user_id;
    END IF;
  ELSE
    RAISE NOTICE 'Found user ID in public.users: %', target_user_id;
  END IF;

  IF target_user_id IS NOT NULL THEN
    -- Delete from business_users
    DELETE FROM public.business_users
    WHERE user_id = target_user_id;
    GET DIAGNOSTICS deleted_business_users_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % business_users entries', deleted_business_users_count;

    -- Delete from user_roles
    DELETE FROM public.user_roles
    WHERE user_id = target_user_id;
    GET DIAGNOSTICS deleted_user_roles_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % user_roles entries', deleted_user_roles_count;

    -- Update hr_contracts to clear employee_id (don't delete contracts, just unlink)
    UPDATE public.hr_contracts
    SET employee_id = NULL
    WHERE employee_id = target_user_id;
    RAISE NOTICE 'Cleared employee_id from hr_contracts';

    -- Delete from public.users
    DELETE FROM public.users
    WHERE id = target_user_id;
    RAISE NOTICE 'Deleted from public.users';

    -- Delete from auth.users (Supabase Auth)
    DELETE FROM auth.users
    WHERE id = target_user_id;
    RAISE NOTICE 'Deleted from auth.users';
  END IF;

  -- Delete all contracts for this email
  DELETE FROM public.hr_contracts
  WHERE employee_email = LOWER(TRIM(target_email));
  GET DIAGNOSTICS deleted_contracts_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % contracts for email %', deleted_contracts_count, target_email;

  RAISE NOTICE '========== CLEANUP SUMMARY ==========';
  RAISE NOTICE 'Contracts deleted: %', deleted_contracts_count;
  RAISE NOTICE 'business_users deleted: %', deleted_business_users_count;
  RAISE NOTICE 'user_roles deleted: %', deleted_user_roles_count;
  RAISE NOTICE 'Cleanup complete!';
END $$;

-- Verify deletion
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM public.users WHERE email = 'accounting@tanggo.ca')
    THEN 'ERROR: User still exists in public.users'
    WHEN EXISTS (SELECT 1 FROM auth.users WHERE email = 'accounting@tanggo.ca')
    THEN 'ERROR: User still exists in auth.users'
    WHEN EXISTS (SELECT 1 FROM public.hr_contracts WHERE employee_email = 'accounting@tanggo.ca')
    THEN 'ERROR: Contracts still exist'
    ELSE 'SUCCESS: All records deleted ✓'
  END as deletion_status;

-- Show summary
SELECT
  'Summary' as info,
  (SELECT COUNT(*) FROM public.users WHERE email = 'accounting@tanggo.ca') as remaining_users,
  (SELECT COUNT(*) FROM auth.users WHERE email = 'accounting@tanggo.ca') as remaining_auth_users,
  (SELECT COUNT(*) FROM public.hr_contracts WHERE employee_email = 'accounting@tanggo.ca') as remaining_contracts,
  (SELECT COUNT(*) FROM public.business_users bu
   JOIN public.users u ON bu.user_id = u.id
   WHERE u.email = 'accounting@tanggo.ca') as remaining_business_users;

COMMIT;

-- ============================================================================
-- Original: delete_user_accounting_tanggo.sql
-- ============================================================================
-- Delete user: accounting@tanggo.ca
-- This script safely deletes the user and all related records
-- Run this in Supabase SQL Editor

BEGIN;

DO $$
DECLARE
  target_user_id UUID;
  target_auth_uid UUID;
  user_email TEXT := LOWER(TRIM('accounting@tanggo.ca'));
BEGIN
  -- Get the user ID from public.users
  SELECT id INTO target_user_id
  FROM public.users
  WHERE email = user_email;

  IF target_user_id IS NULL THEN
    RAISE NOTICE 'User with email % not found in public.users', user_email;
    RETURN;
  END IF;

  RAISE NOTICE 'Found user ID: %', target_user_id;

  -- Get the auth user ID (users.id should match auth.users.id)
  SELECT id INTO target_auth_uid
  FROM auth.users
  WHERE id = target_user_id;

  -- Step 1: Delete from user_roles (must delete first)
  DELETE FROM public.user_roles
  WHERE user_id = target_user_id;

  RAISE NOTICE 'Deleted from user_roles';

  -- Step 2: Delete from business_users (must delete before users)
  DELETE FROM public.business_users
  WHERE user_id = target_user_id;

  RAISE NOTICE 'Deleted from business_users';

  -- Step 3: Update hr_contracts to remove employee_id reference (set to NULL to preserve contracts)
  UPDATE public.hr_contracts
  SET employee_id = NULL
  WHERE employee_id = target_user_id;

  RAISE NOTICE 'Cleared employee_id from hr_contracts';

  -- Step 4: Delete from public.users
  DELETE FROM public.users
  WHERE id = target_user_id;

  RAISE NOTICE 'Deleted from public.users';

  -- Step 5: Delete from auth.users (Supabase Auth)
  -- WARNING: This will delete the authentication account
  IF target_auth_uid IS NOT NULL THEN
    DELETE FROM auth.users
    WHERE id = target_auth_uid;

    RAISE NOTICE 'Deleted from auth.users';
  ELSE
    RAISE NOTICE 'No matching auth.users record found (may have been deleted already)';
  END IF;

  RAISE NOTICE 'User deletion complete!';
END $$;

-- Verify deletion
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM public.users WHERE email = LOWER(TRIM('accounting@tanggo.ca')))
    THEN 'ERROR: User still exists in public.users'
    ELSE 'SUCCESS: User deleted from public.users ✓'
  END as deletion_status;

COMMIT;

-- ============================================================================
-- Original: quick_cleanup_accounting_tanggo.sql
-- ============================================================================
-- Quick cleanup for accounting@tanggo.ca - ready to use
-- Run this to delete everything for accounting@tanggo.ca and retest

DO $$
DECLARE
  v_email TEXT := 'accounting@tanggo.ca';
  v_user_id UUID;
  v_auth_user_id UUID;
BEGIN
  -- Find the user in public.users
  SELECT id INTO v_user_id
  FROM public.users
  WHERE email = LOWER(TRIM(v_email));

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User not found in public.users: %', v_email;
  ELSE
    RAISE NOTICE 'Found user: % (ID: %)', v_email, v_user_id;

    -- Find auth user
    SELECT id INTO v_auth_user_id
    FROM auth.users
    WHERE email = LOWER(TRIM(v_email));

    -- Delete in correct order
    DELETE FROM public.user_roles WHERE user_id = v_user_id;
    DELETE FROM public.business_users WHERE user_id = v_user_id OR (v_auth_user_id IS NOT NULL AND user_id = v_auth_user_id);
    DELETE FROM public.hr_contracts WHERE employee_email = LOWER(TRIM(v_email));
    DELETE FROM public.users WHERE id = v_user_id;

    IF v_auth_user_id IS NOT NULL THEN
      DELETE FROM auth.users WHERE id = v_auth_user_id;
    END IF;

    RAISE NOTICE '✅ Cleanup complete for: %', v_email;
  END IF;
END $$;

-- ============================================================================
-- Original: diagnose_accounting_tanggo.sql
-- ============================================================================
-- ============================================
-- DIAGNOSTIC QUERIES FOR accounting@tanggo.ca
-- Run these to see EXACTLY what's in the database
-- ============================================

-- 1. Check if user exists in users table (exact match)
SELECT
    'USERS TABLE (exact match)' as query_type,
    id,
    email,
    LOWER(email) as email_lower,
    TRIM(LOWER(email)) as email_normalized,
    hashed_password IS NOT NULL as has_password,
    pin IS NOT NULL as has_pin,
    employment_status,
    created_at
FROM users
WHERE email = 'accounting@tanggo.ca';

-- 2. Check if user exists in users table (case-insensitive)
SELECT
    'USERS TABLE (case-insensitive)' as query_type,
    id,
    email,
    LOWER(email) as email_lower,
    TRIM(LOWER(email)) as email_normalized,
    hashed_password IS NOT NULL as has_password,
    pin IS NOT NULL as has_pin,
    employment_status,
    created_at
FROM users
WHERE LOWER(TRIM(email)) = LOWER(TRIM('accounting@tanggo.ca'));

-- 3. Check if user exists via user_roles (how Employee Profiles loads)
SELECT
    'USER_ROLES JOIN' as query_type,
    ur.user_id,
    ur.role,
    ur.business_id,
    ur.active,
    u.id as user_id_from_users,
    u.email,
    LOWER(u.email) as email_lower,
    TRIM(LOWER(u.email)) as email_normalized,
    u.hashed_password IS NOT NULL as has_password,
    u.pin IS NOT NULL as has_pin,
    u.employment_status
FROM user_roles ur
INNER JOIN users u ON ur.user_id = u.id
WHERE ur.active = true
  AND LOWER(TRIM(u.email)) = LOWER(TRIM('accounting@tanggo.ca'));

-- 4. Check ALL users with similar email (to see if there's a typo)
SELECT
    'SIMILAR EMAILS' as query_type,
    id,
    email,
    LOWER(email) as email_lower,
    LENGTH(email) as email_length,
    created_at
FROM users
WHERE email ILIKE '%accounting%'
   OR email ILIKE '%tanggo%'
ORDER BY email;

-- 5. Check business_users table
SELECT
    'BUSINESS_USERS' as query_type,
    bu.user_id,
    bu.business_id,
    u.email,
    u.id as user_id_from_users
FROM business_users bu
LEFT JOIN users u ON bu.user_id = u.id
WHERE u.email ILIKE '%accounting@tanggo.ca%'
   OR u.email = 'accounting@tanggo.ca';

-- 6. Check ALL user_roles entries (to see structure)
SELECT
    'ALL USER_ROLES (first 20)' as query_type,
    ur.user_id,
    ur.role,
    ur.business_id,
    ur.active,
    u.email,
    u.id
FROM user_roles ur
LEFT JOIN users u ON ur.user_id = u.id
WHERE ur.active = true
ORDER BY ur.created_at DESC
LIMIT 20;

-- 7. Check if email has any hidden characters or encoding issues
SELECT
    'EMAIL CHARACTER ANALYSIS' as query_type,
    id,
    email,
    LENGTH(email) as length,
    OCTET_LENGTH(email) as byte_length,
    encode(email::bytea, 'hex') as email_hex,
    ascii(email) as first_char_ascii
FROM users
WHERE email ILIKE '%accounting%tanggo%'
ORDER BY email;

-- 8. Check RLS policies on users table (if accessible)
SELECT
    'RLS POLICIES CHECK' as query_type,
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'users'
   OR tablename = 'user_roles';

-- 9. Count total users and user_roles
SELECT
    'COUNTS' as query_type,
    (SELECT COUNT(*) FROM users) as total_users,
    (SELECT COUNT(*) FROM user_roles WHERE active = true) as active_user_roles,
    (SELECT COUNT(*) FROM users WHERE email ILIKE '%accounting%') as users_with_accounting_in_email,
    (SELECT COUNT(*) FROM users WHERE email ILIKE '%tanggo%') as users_with_tanggo_in_email;
