-- One-off operational SQL for accounting@tanggo.ca recovery / cleanup.
-- Do not place this file under supabase/migrations. Run only manually in the SQL editor.

-- ============================================================================
-- Clear password and PIN for first-time login flow
-- ============================================================================
UPDATE users
SET
  hashed_password = NULL,
  pin = NULL,
  updated_at = NOW()
WHERE email = 'accounting@tanggo.ca';

SELECT
  id,
  email,
  hashed_password IS NULL AS password_cleared,
  pin IS NULL AS pin_cleared
FROM users
WHERE email = 'accounting@tanggo.ca';

-- ============================================================================
-- Diagnostic queries for accounting@tanggo.ca
-- ============================================================================
SELECT
    'USERS TABLE (exact match)' AS query_type,
    id,
    email,
    LOWER(email) AS email_lower,
    TRIM(LOWER(email)) AS email_normalized,
    hashed_password IS NOT NULL AS has_password,
    pin IS NOT NULL AS has_pin,
    employment_status,
    created_at
FROM users
WHERE email = 'accounting@tanggo.ca';

SELECT
    'USERS TABLE (case-insensitive)' AS query_type,
    id,
    email,
    LOWER(email) AS email_lower,
    TRIM(LOWER(email)) AS email_normalized,
    hashed_password IS NOT NULL AS has_password,
    pin IS NOT NULL AS has_pin,
    employment_status,
    created_at
FROM users
WHERE LOWER(TRIM(email)) = LOWER(TRIM('accounting@tanggo.ca'));

SELECT
    'USER_ROLES JOIN' AS query_type,
    ur.user_id,
    ur.role,
    ur.business_id,
    ur.active,
    u.id AS user_id_from_users,
    u.email,
    LOWER(u.email) AS email_lower,
    TRIM(LOWER(u.email)) AS email_normalized,
    u.hashed_password IS NOT NULL AS has_password,
    u.pin IS NOT NULL AS has_pin,
    u.employment_status
FROM user_roles ur
INNER JOIN users u ON ur.user_id = u.id
WHERE ur.active = true
  AND LOWER(TRIM(u.email)) = LOWER(TRIM('accounting@tanggo.ca'));

SELECT
    'SIMILAR EMAILS' AS query_type,
    id,
    email,
    LOWER(email) AS email_lower,
    LENGTH(email) AS email_length,
    created_at
FROM users
WHERE email ILIKE '%accounting%'
   OR email ILIKE '%tanggo%'
ORDER BY email;

SELECT
    'BUSINESS_USERS' AS query_type,
    bu.user_id,
    bu.business_id,
    u.email,
    u.id AS user_id_from_users
FROM business_users bu
LEFT JOIN users u ON bu.user_id = u.id
WHERE u.email ILIKE '%accounting@tanggo.ca%'
   OR u.email = 'accounting@tanggo.ca';

SELECT
    'ALL USER_ROLES (first 20)' AS query_type,
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

SELECT
    'EMAIL CHARACTER ANALYSIS' AS query_type,
    id,
    email,
    LENGTH(email) AS length,
    OCTET_LENGTH(email) AS byte_length,
    encode(email::bytea, 'hex') AS email_hex,
    ascii(email) AS first_char_ascii
FROM users
WHERE email ILIKE '%accounting%tanggo%'
ORDER BY email;

SELECT
    'RLS POLICIES CHECK' AS query_type,
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

SELECT
    'COUNTS' AS query_type,
    (SELECT COUNT(*) FROM users) AS total_users,
    (SELECT COUNT(*) FROM user_roles WHERE active = true) AS active_user_roles,
    (SELECT COUNT(*) FROM users WHERE email ILIKE '%accounting%') AS users_with_accounting_in_email,
    (SELECT COUNT(*) FROM users WHERE email ILIKE '%tanggo%') AS users_with_tanggo_in_email;

-- ============================================================================
-- Quick cleanup / deletion helpers
-- ============================================================================
DO $$
DECLARE
  v_email TEXT := 'accounting@tanggo.ca';
  v_user_id UUID;
  v_auth_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM public.users
  WHERE email = LOWER(TRIM(v_email));

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User not found in public.users: %', v_email;
  ELSE
    RAISE NOTICE 'Found user: % (ID: %)', v_email, v_user_id;

    SELECT id INTO v_auth_user_id
    FROM auth.users
    WHERE email = LOWER(TRIM(v_email));

    DELETE FROM public.user_roles WHERE user_id = v_user_id;
    DELETE FROM public.business_users WHERE user_id = v_user_id OR (v_auth_user_id IS NOT NULL AND user_id = v_auth_user_id);
    DELETE FROM public.hr_contracts WHERE employee_email = LOWER(TRIM(v_email));
    DELETE FROM public.users WHERE id = v_user_id;

    IF v_auth_user_id IS NOT NULL THEN
      DELETE FROM auth.users WHERE id = v_auth_user_id;
    END IF;

    RAISE NOTICE 'Cleanup complete for: %', v_email;
  END IF;
END $$;

BEGIN;

DO $$
DECLARE
  target_email TEXT := 'accounting@tanggo.ca';
  target_user_id UUID;
  deleted_contracts_count INT := 0;
  deleted_business_users_count INT := 0;
  deleted_user_roles_count INT := 0;
BEGIN
  SELECT id INTO target_user_id
  FROM public.users
  WHERE email = LOWER(TRIM(target_email));

  IF target_user_id IS NULL THEN
    RAISE NOTICE 'User with email % not found in public.users', target_email;
  ELSE
    RAISE NOTICE 'Found user ID: %', target_user_id;

    DELETE FROM public.business_users
    WHERE user_id = target_user_id;
    GET DIAGNOSTICS deleted_business_users_count = ROW_COUNT;

    DELETE FROM public.user_roles
    WHERE user_id = target_user_id;
    GET DIAGNOSTICS deleted_user_roles_count = ROW_COUNT;

    UPDATE public.hr_contracts
    SET employee_id = NULL
    WHERE employee_id = target_user_id;

    DELETE FROM public.users
    WHERE id = target_user_id;

    DELETE FROM auth.users
    WHERE id = target_user_id;
  END IF;

  DELETE FROM public.hr_contracts
  WHERE employee_email = LOWER(TRIM(target_email));
  GET DIAGNOSTICS deleted_contracts_count = ROW_COUNT;

  RAISE NOTICE 'Deleted % contracts for email %', deleted_contracts_count, target_email;
END $$;

SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM public.users WHERE email = 'accounting@tanggo.ca')
      THEN 'ERROR: User still exists'
    WHEN EXISTS (SELECT 1 FROM public.hr_contracts WHERE employee_email = 'accounting@tanggo.ca')
      THEN 'ERROR: Contracts still exist'
    ELSE 'SUCCESS: All records deleted'
  END AS deletion_status;

COMMIT;

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

  SELECT id INTO target_user_id
  FROM public.users
  WHERE email = LOWER(TRIM(target_email));

  IF target_user_id IS NULL THEN
    RAISE NOTICE 'User with email % not found in public.users', target_email;

    SELECT id INTO target_user_id
    FROM auth.users
    WHERE email = LOWER(TRIM(target_email));
  END IF;

  IF target_user_id IS NOT NULL THEN
    DELETE FROM public.business_users WHERE user_id = target_user_id;
    GET DIAGNOSTICS deleted_business_users_count = ROW_COUNT;

    DELETE FROM public.user_roles WHERE user_id = target_user_id;
    GET DIAGNOSTICS deleted_user_roles_count = ROW_COUNT;

    UPDATE public.hr_contracts
    SET employee_id = NULL
    WHERE employee_id = target_user_id;

    DELETE FROM public.users WHERE id = target_user_id;
    DELETE FROM auth.users WHERE id = target_user_id;
  END IF;

  DELETE FROM public.hr_contracts
  WHERE employee_email = LOWER(TRIM(target_email));
  GET DIAGNOSTICS deleted_contracts_count = ROW_COUNT;
END $$;

COMMIT;
