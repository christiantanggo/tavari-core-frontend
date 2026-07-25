-- ============================================================================
-- PHASE 1, STEP 25: Test all database changes
-- ============================================================================
-- Purpose: Verify all Phase 1 database changes are working correctly
--          Run this script after applying all Phase 1 migrations
-- ============================================================================

-- Test 1: Verify music_installations cache columns exist
SELECT 
  column_name, 
  data_type, 
  is_nullable, 
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'music_installations'
  AND column_name IN (
    'cached_tracks_count',
    'cache_size_bytes',
    'last_cache_sync',
    'cache_version',
    'offline_mode_enabled',
    'max_cache_size_mb'
  )
ORDER BY column_name;

-- Test 2: Verify music_installation_cache table exists with correct structure
SELECT 
  column_name, 
  data_type, 
  is_nullable, 
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'music_installation_cache'
ORDER BY ordinal_position;

-- Test 3: Verify foreign key constraints
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('music_installation_cache', 'music_installation_health')
ORDER BY tc.table_name, tc.constraint_name;

-- Test 4: Verify check constraints
SELECT
  tc.constraint_name,
  tc.table_name,
  cc.check_clause
FROM information_schema.table_constraints AS tc
JOIN information_schema.check_constraints AS cc
  ON tc.constraint_name = cc.constraint_name
WHERE tc.constraint_type = 'CHECK'
  AND tc.table_name = 'music_installation_cache'
ORDER BY tc.constraint_name;

-- Test 5: Verify unique constraints
SELECT
  tc.constraint_name,
  tc.table_name,
  string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'UNIQUE'
  AND tc.table_name = 'music_installation_cache'
GROUP BY tc.constraint_name, tc.table_name;

-- Test 6: Verify music_installation_health table exists
SELECT 
  column_name, 
  data_type, 
  is_nullable, 
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'music_installation_health'
ORDER BY ordinal_position;

-- Test 7: Verify indexes exist
SELECT
  indexname,
  tablename,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (
    indexname LIKE '%music_installations%' OR
    indexname LIKE '%installation_cache%' OR
    indexname LIKE '%installation_health%'
  )
ORDER BY tablename, indexname;

-- Test 8: Verify RLS is enabled
SELECT
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('music_installation_cache', 'music_installation_health');

-- Test 9: Verify RLS policies exist
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('music_installation_cache', 'music_installation_health')
ORDER BY tablename, policyname;

-- Test 10: Verify functions exist
SELECT
  routine_name,
  routine_type,
  data_type AS return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'get_installation_cache_stats',
    'cleanup_expired_cache_entries',
    'update_installation_cache_stats'
  )
ORDER BY routine_name;

-- Test 11: Verify trigger exists
SELECT
  trigger_name,
  event_object_table,
  action_timing,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'music_installation_cache'
  AND trigger_name = 'trg_update_installation_cache_stats';

-- Test 12: Test function get_installation_cache_stats (requires valid installation_id)
-- Uncomment and replace with actual installation_id to test:
-- SELECT get_installation_cache_stats('00000000-0000-0000-0000-000000000000'::UUID);

-- Test 13: Test function cleanup_expired_cache_entries
-- This should return 0 if no expired entries exist
SELECT cleanup_expired_cache_entries() AS deleted_count;

-- Summary
SELECT 
  'Phase 1 Database Changes Test Complete' AS status,
  COUNT(*) FILTER (WHERE table_name = 'music_installation_cache') AS cache_table_exists,
  COUNT(*) FILTER (WHERE table_name = 'music_installation_health') AS health_table_exists
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('music_installation_cache', 'music_installation_health');




