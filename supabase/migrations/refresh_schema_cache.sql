-- Refresh PostgREST schema cache
-- This forces Supabase to recognize newly added columns immediately
-- Run this after adding columns to fix "column does not exist" errors

-- ============================================================================
-- REFRESH SCHEMA CACHE
-- ============================================================================

-- Notify PostgREST to reload the schema cache
-- This makes newly added columns immediately available via the REST API
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify columns exist in the database
SELECT 
    'COLUMN VERIFICATION' as check_type,
    table_name,
    column_name,
    data_type,
    '✅ Column exists in database' as status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'hr_contracts' AND column_name = 'personal_info_token')
    OR (table_name = 'users' AND column_name = 'personal_info_token')
  )
ORDER BY table_name, column_name;

-- ============================================================================
-- NOTE
-- ============================================================================
-- After running this, wait 10-30 seconds for the cache to refresh
-- Then try the personal info form again
-- 
-- If it still doesn't work, you may need to:
-- 1. Wait a few more minutes (cache can take time)
-- 2. Restart your Supabase project (in Dashboard → Settings → Restart)
-- 3. Contact Supabase support if the issue persists
















