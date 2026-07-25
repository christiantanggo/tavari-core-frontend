-- ============================================
-- RESTORE OWNER ACCOUNT
-- ============================================
-- This script helps restore an owner account if it was accidentally deleted
-- Replace 'OWNER_EMAIL_HERE' with the actual owner email address
-- ============================================

-- Step 1: Check if owner exists in users table
DO $$
DECLARE
    owner_email TEXT := '5@tanggo.ca';  -- Owner email
    owner_user_id UUID;
    owner_auth_id UUID;
    owner_record RECORD;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'CHECKING OWNER ACCOUNT STATUS';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Searching for email: %', owner_email;
    RAISE NOTICE '';
    
    -- Check users table (try multiple variations)
    SELECT id, email, first_name, last_name, full_name
    INTO owner_record
    FROM users
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(owner_email))
       OR email = owner_email
       OR email LIKE '%5@tanggo.ca%';
    
    IF owner_record IS NULL THEN
        RAISE NOTICE '❌ Owner NOT found in users table';
        RAISE NOTICE 'You may need to recreate the user record first';
        RETURN;
    ELSE
        RAISE NOTICE '✅ Owner found in users table:';
        RAISE NOTICE '   ID: %', owner_record.id;
        RAISE NOTICE '   Email: %', owner_record.email;
        RAISE NOTICE '   Name: % %', owner_record.first_name, owner_record.last_name;
        owner_user_id := owner_record.id;
    END IF;
    
    -- Check auth.users table (try multiple variations)
    SELECT id INTO owner_auth_id
    FROM auth.users
    WHERE LOWER(TRIM(email)) = LOWER(TRIM(owner_email))
       OR email = owner_email
       OR email LIKE '%5@tanggo.ca%';
    
    IF owner_auth_id IS NULL THEN
        RAISE NOTICE '❌ Owner NOT found in auth.users table';
        RAISE NOTICE '⚠️  Auth account needs to be recreated';
        RAISE NOTICE '';
        RAISE NOTICE 'To restore:';
        RAISE NOTICE '1. Use Supabase Dashboard > Authentication > Users > Add User';
        RAISE NOTICE '2. Or use the create-employee-auth Edge Function';
        RAISE NOTICE '3. Email: %', owner_email;
        RAISE NOTICE '4. User ID in users table: %', owner_user_id;
    ELSE
        RAISE NOTICE '✅ Owner found in auth.users table:';
        RAISE NOTICE '   Auth ID: %', owner_auth_id;
        
        -- Check if IDs match
        IF owner_auth_id != owner_user_id THEN
            RAISE NOTICE '⚠️  WARNING: ID mismatch!';
            RAISE NOTICE '   users.id: %', owner_user_id;
            RAISE NOTICE '   auth.users.id: %', owner_auth_id;
            RAISE NOTICE '   This may cause login issues';
        END IF;
    END IF;
    
    -- Check business_users relationship
    RAISE NOTICE '';
    RAISE NOTICE 'Checking business_users relationships...';
    FOR owner_record IN 
        SELECT bu.id, bu.business_id, bu.role, b.name as business_name
        FROM business_users bu
        JOIN businesses b ON bu.business_id = b.id
        WHERE bu.user_id = owner_user_id
    LOOP
        RAISE NOTICE '   Business: % (Role: %)', owner_record.business_name, owner_record.role;
    END LOOP;
    
    -- Check user_roles
    RAISE NOTICE '';
    RAISE NOTICE 'Checking user_roles...';
    FOR owner_record IN 
        SELECT role, business_id
        FROM user_roles
        WHERE user_id = owner_user_id
    LOOP
        RAISE NOTICE '   Role: % (Business ID: %)', owner_record.role, owner_record.business_id;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'DIAGNOSTIC COMPLETE';
    RAISE NOTICE '========================================';
END $$;

-- ============================================
-- OPTION 1: Reset password via Supabase Dashboard
-- ============================================
-- 1. Go to Supabase Dashboard
-- 2. Authentication > Users
-- 3. Find user by email
-- 4. Click "Send Password Reset Email" or manually set password

-- ============================================
-- OPTION 2: Use Edge Function to recreate auth account
-- ============================================
-- Call the create-employee-auth Edge Function:
-- POST https://YOUR_PROJECT.supabase.co/functions/v1/create-employee-auth
-- Headers:
--   Authorization: Bearer YOUR_SERVICE_ROLE_KEY
--   Content-Type: application/json
-- Body:
-- {
--   "method": "password",
--   "employee_email": "5@tanggo.ca",
--   "employee_id": "USER_ID_FROM_USERS_TABLE",
--   "first_name": "Owner",
--   "last_name": "Name",
--   "full_name": "Owner Name",
--   "temporary_password": "TempPassword123!"
-- }

-- ============================================
-- OPTION 3: Check if account was deleted by deletion script
-- ============================================
-- Run this to see if the owner was affected by the deletion script:
SELECT 
    'users' as table_name,
    id,
    email,
    first_name,
    last_name,
    created_at
FROM users
WHERE LOWER(email) = LOWER('5@tanggo.ca')
   OR email = '5@tanggo.ca'
   OR email LIKE '%5@tanggo.ca%';

