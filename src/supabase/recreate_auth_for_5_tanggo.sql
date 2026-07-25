-- ============================================
-- RECREATE AUTH ACCOUNT FOR 5@tanggo.ca
-- ============================================
-- This script helps recreate the auth account if it's missing
-- ============================================

-- First, find the user ID from users table
DO $$
DECLARE
    owner_user_id UUID;
    owner_email TEXT;
    owner_first_name TEXT;
    owner_last_name TEXT;
    owner_full_name TEXT;
    auth_exists BOOLEAN;
BEGIN
    -- Find the owner in users table
    SELECT id, email, first_name, last_name, full_name
    INTO owner_user_id, owner_email, owner_first_name, owner_last_name, owner_full_name
    FROM users
    WHERE 
        email = '5@tanggo.ca'
        OR LOWER(email) = '5@tanggo.ca'
        OR TRIM(email) = '5@tanggo.ca'
        OR LOWER(TRIM(email)) = '5@tanggo.ca'
        OR email LIKE '%5@tanggo.ca%'
    LIMIT 1;
    
    IF owner_user_id IS NULL THEN
        RAISE NOTICE '❌ User not found in users table';
        RETURN;
    END IF;
    
    RAISE NOTICE '✅ Found user in users table:';
    RAISE NOTICE '   ID: %', owner_user_id;
    RAISE NOTICE '   Email: %', owner_email;
    RAISE NOTICE '   Name: % %', owner_first_name, owner_last_name;
    RAISE NOTICE '';
    
    -- Check if auth account exists
    SELECT EXISTS(
        SELECT 1 FROM auth.users 
        WHERE id = owner_user_id 
           OR LOWER(TRIM(email)) = LOWER(TRIM(owner_email))
    ) INTO auth_exists;
    
    IF auth_exists THEN
        RAISE NOTICE '✅ Auth account already exists';
        RAISE NOTICE '   The issue may be with the password';
        RAISE NOTICE '';
        RAISE NOTICE 'To fix:';
        RAISE NOTICE '1. Go to Supabase Dashboard > Authentication > Users';
        RAISE NOTICE '2. Find user: %', owner_email;
        RAISE NOTICE '3. Click "Send Password Reset Email" or manually set password';
    ELSE
        RAISE NOTICE '❌ Auth account NOT found';
        RAISE NOTICE '';
        RAISE NOTICE '⚠️  Auth account needs to be created';
        RAISE NOTICE '';
        RAISE NOTICE 'To create auth account, use one of these methods:';
        RAISE NOTICE '';
        RAISE NOTICE 'METHOD 1: Via Supabase Dashboard';
        RAISE NOTICE '1. Go to Supabase Dashboard > Authentication > Users';
        RAISE NOTICE '2. Click "Add User"';
        RAISE NOTICE '3. Email: %', owner_email;
        RAISE NOTICE '4. Set a temporary password';
        RAISE NOTICE '5. IMPORTANT: The user ID must match: %', owner_user_id;
        RAISE NOTICE '   (You may need to use Supabase Admin API to set the ID)';
        RAISE NOTICE '';
        RAISE NOTICE 'METHOD 2: Via Edge Function (Recommended)';
        RAISE NOTICE 'Call the create-employee-auth Edge Function:';
        RAISE NOTICE 'POST https://YOUR_PROJECT.supabase.co/functions/v1/create-employee-auth';
        RAISE NOTICE 'Headers:';
        RAISE NOTICE '  Authorization: Bearer YOUR_SERVICE_ROLE_KEY';
        RAISE NOTICE '  Content-Type: application/json';
        RAISE NOTICE 'Body:';
        RAISE NOTICE '{';
        RAISE NOTICE '  "method": "password",';
        RAISE NOTICE '  "employee_email": "%",', owner_email;
        RAISE NOTICE '  "employee_id": "%",', owner_user_id;
        RAISE NOTICE '  "first_name": "%",', COALESCE(owner_first_name, '');
        RAISE NOTICE '  "last_name": "%",', COALESCE(owner_last_name, '');
        RAISE NOTICE '  "full_name": "%",', COALESCE(owner_full_name, '');
        RAISE NOTICE '  "temporary_password": "TempPassword123!"';
        RAISE NOTICE '}';
        RAISE NOTICE '';
        RAISE NOTICE 'METHOD 3: Via Supabase Admin API (Advanced)';
        RAISE NOTICE 'Use the Supabase Admin API to create user with specific ID';
    END IF;
    
END $$;


