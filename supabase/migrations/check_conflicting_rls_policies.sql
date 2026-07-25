-- Check for conflicting RLS policies that might block personal info form access
-- This helps identify if other policies are preventing public access

-- ============================================================================
-- ALL SELECT POLICIES ON HR_CONTRACTS
-- ============================================================================

SELECT 
    'HR_CONTRACTS SELECT POLICIES' as section,
    policyname,
    permissive,
    roles,
    qual as using_expression,
    CASE 
        WHEN roles::text LIKE '%public%' OR roles::text = '{}' THEN '✅ Allows public'
        ELSE '⚠️ Restricted to specific roles'
    END as public_access
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'hr_contracts'
  AND cmd = 'SELECT'
ORDER BY policyname;

-- ============================================================================
-- ALL SELECT POLICIES ON USERS
-- ============================================================================

SELECT 
    'USERS SELECT POLICIES' as section,
    policyname,
    permissive,
    roles,
    qual as using_expression,
    CASE 
        WHEN roles::text LIKE '%public%' OR roles::text = '{}' THEN '✅ Allows public'
        ELSE '⚠️ Restricted to specific roles'
    END as public_access
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'users'
  AND cmd = 'SELECT'
ORDER BY policyname;

-- ============================================================================
-- CHECK IF THERE ARE RESTRICTIVE POLICIES
-- ============================================================================

SELECT 
    'POLICY TYPE CHECK' as section,
    tablename,
    COUNT(*) FILTER (WHERE permissive = true) as permissive_policies,
    COUNT(*) FILTER (WHERE permissive = false) as restrictive_policies,
    COUNT(*) FILTER (WHERE roles::text LIKE '%public%' OR roles::text = '{}') as public_policies
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('hr_contracts', 'users')
  AND cmd = 'SELECT'
GROUP BY tablename;

-- ============================================================================
-- IMPORTANT NOTE
-- ============================================================================
-- In PostgreSQL RLS:
-- - Multiple permissive policies are combined with OR (any can allow access)
-- - Restrictive policies are combined with AND (all must allow access)
-- - If a restrictive policy exists, it can block access even if permissive policies allow it
-- 
-- For public access to work, we need at least ONE permissive policy that allows
-- access when personal_info_token IS NOT NULL, and NO restrictive policies that block it.
















