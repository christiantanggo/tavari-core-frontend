-- Enable RLS on users table for personal info form access
-- RLS must be enabled for policies to work

-- ============================================================================
-- ENABLE RLS ON USERS TABLE
-- ============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- VERIFY RLS IS ENABLED
-- ============================================================================

SELECT 
    'RLS STATUS' as check_type,
    tablename,
    rowsecurity as rls_enabled,
    CASE 
        WHEN rowsecurity = true THEN '✅ RLS Enabled'
        ELSE '❌ RLS Disabled'
    END as status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'users';

-- ============================================================================
-- NOTE
-- ============================================================================
-- After enabling RLS, existing policies will be enforced.
-- Make sure you have policies that allow:
-- 1. Authenticated users to access their own data
-- 2. Public access via personal_info_token (already created)
-- 3. Any other access patterns your app needs
















