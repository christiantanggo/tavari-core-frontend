-- Enable RLS on users table and ensure necessary policies exist
-- This allows both authenticated and unauthenticated access patterns

-- ============================================================================
-- STEP 1: ENABLE RLS ON USERS TABLE
-- ============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 2: CHECK FOR EXISTING USER ACCESS POLICIES
-- ============================================================================

SELECT 
    'EXISTING POLICIES' as section,
    policyname,
    cmd as command,
    qual as using_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'users'
ORDER BY cmd, policyname;

-- ============================================================================
-- STEP 3: CREATE BASIC POLICIES IF THEY DON'T EXIST
-- ============================================================================

-- Policy: Users can view their own record (by auth.uid())
-- This is a common pattern for user tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND policyname = 'Users can view their own record'
  ) THEN
    CREATE POLICY "Users can view their own record"
      ON users FOR SELECT
      USING (auth.uid() = id);
    
    RAISE NOTICE 'Created policy: Users can view their own record';
  ELSE
    RAISE NOTICE 'Policy "Users can view their own record" already exists';
  END IF;
END $$;

-- Policy: Users can update their own record
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND policyname = 'Users can update their own record'
  ) THEN
    CREATE POLICY "Users can update their own record"
      ON users FOR UPDATE
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);
    
    RAISE NOTICE 'Created policy: Users can update their own record';
  ELSE
    RAISE NOTICE 'Policy "Users can update their own record" already exists';
  END IF;
END $$;

-- ============================================================================
-- STEP 4: VERIFY ALL POLICIES EXIST
-- ============================================================================

SELECT 
    'FINAL POLICY CHECK' as section,
    policyname,
    cmd as command,
    roles,
    CASE 
        WHEN roles::text LIKE '%public%' OR roles::text = '{}' THEN '✅ Public access'
        WHEN qual LIKE '%auth.uid()%' THEN '✅ Authenticated access'
        ELSE '⚠️ Check policy'
    END as access_type
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'users'
ORDER BY cmd, policyname;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 
    'VERIFICATION' as check_type,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_tables
            WHERE schemaname = 'public'
              AND tablename = 'users'
              AND rowsecurity = true
        )
        THEN '✅ RLS is enabled on users table'
        ELSE '❌ RLS is NOT enabled on users table'
    END as rls_status,
    (
        SELECT COUNT(*)
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'users'
    ) as total_policies_count;
















