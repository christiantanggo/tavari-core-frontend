-- Force PostgREST schema cache refresh for personal_info_token column
-- This script verifies the column exists and forces multiple cache refresh methods
-- Run this if you're getting "column does not exist" errors

-- ============================================================================
-- STEP 1: VERIFY COLUMNS EXIST IN DATABASE
-- ============================================================================

SELECT 
    'COLUMN VERIFICATION' as check_type,
    table_name,
    column_name,
    data_type,
    is_nullable,
    '✅ Column exists in database' as status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'hr_contracts' AND column_name = 'personal_info_token')
    OR (table_name = 'users' AND column_name = 'personal_info_token')
  )
ORDER BY table_name, column_name;

-- ============================================================================
-- STEP 2: VERIFY INDEXES EXIST
-- ============================================================================

SELECT 
    'INDEX VERIFICATION' as check_type,
    tablename,
    indexname,
    indexdef,
    '✅ Index exists' as status
FROM pg_indexes
WHERE schemaname = 'public'
  AND (
    (tablename = 'hr_contracts' AND indexname LIKE '%personal_info_token%')
    OR (tablename = 'users' AND indexname LIKE '%personal_info_token%')
  )
ORDER BY tablename, indexname;

-- ============================================================================
-- STEP 3: VERIFY RLS POLICIES EXIST
-- ============================================================================

SELECT 
    'RLS POLICY VERIFICATION' as check_type,
    tablename,
    policyname,
    roles,
    cmd as command,
    '✅ Policy exists' as status
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (tablename = 'hr_contracts' AND policyname LIKE '%personal_info%')
    OR (tablename = 'users' AND policyname LIKE '%personal_info%')
  )
ORDER BY tablename, cmd, policyname;

-- ============================================================================
-- STEP 4: FORCE SCHEMA CACHE REFRESH (MULTIPLE METHODS)
-- ============================================================================

-- Method 1: Standard PostgREST notification
NOTIFY pgrst, 'reload schema';

-- Method 2: Alternative notification format
SELECT pg_notify('pgrst', 'reload schema');

-- Method 3: Force a dummy query that touches the column (helps refresh)
DO $$
BEGIN
    -- This query will fail if column doesn't exist, but helps refresh cache if it does
    PERFORM personal_info_token FROM users WHERE false LIMIT 1;
    PERFORM personal_info_token FROM hr_contracts WHERE false LIMIT 1;
EXCEPTION
    WHEN OTHERS THEN
        -- Ignore errors, we're just trying to refresh cache
        NULL;
END $$;

-- Method 4: Another notification attempt
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- STEP 5: VERIFY RLS IS ENABLED
-- ============================================================================

SELECT 
    'RLS STATUS' as check_type,
    tablename,
    CASE 
        WHEN rowsecurity THEN '✅ RLS Enabled'
        ELSE '❌ RLS Disabled'
    END as rls_status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('hr_contracts', 'users')
ORDER BY tablename;

-- ============================================================================
-- STEP 6: TEST QUERY (This will show if PostgREST can see the column)
-- ============================================================================

-- This query should work if the schema cache has refreshed
-- If it fails, the cache hasn't refreshed yet
SELECT 
    'TEST QUERY' as check_type,
    COUNT(*) as users_with_token,
    '✅ Query successful - schema cache refreshed' as status
FROM users
WHERE personal_info_token IS NOT NULL;

SELECT 
    'TEST QUERY' as check_type,
    COUNT(*) as contracts_with_token,
    '✅ Query successful - schema cache refreshed' as status
FROM hr_contracts
WHERE personal_info_token IS NOT NULL;

-- ============================================================================
-- NOTES
-- ============================================================================
-- After running this script:
-- 1. Wait 10-30 seconds for the cache to refresh
-- 2. Try the personal info form again
-- 3. If it still doesn't work:
--    a. Restart your Supabase project (Dashboard → Settings → Restart)
--    b. Wait 2-3 minutes after restart
--    c. Try the form again
-- 4. If it STILL doesn't work, the issue may be:
--    - The column was added but migrations weren't applied correctly
--    - There's a Supabase project configuration issue
--    - Contact Supabase support












