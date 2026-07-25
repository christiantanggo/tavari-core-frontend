-- Comprehensive database optimization
-- Run this after adding indexes and cleaning up data

-- 1. Update table statistics for better query planning
ANALYZE;

-- 2. Vacuum to reclaim space and update statistics
VACUUM FULL VERBOSE;

-- 3. Reindex to optimize indexes
REINDEX DATABASE current_database();

-- 4. Check for unused indexes (can be dropped to save space)
SELECT 
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  idx_scan as times_used,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND idx_scan = 0  -- Never used
  AND pg_relation_size(indexrelid) > 1024 * 1024  -- Larger than 1MB
ORDER BY pg_relation_size(indexrelid) DESC;

-- 5. Check for tables that need VACUUM
SELECT 
  schemaname,
  relname,
  n_dead_tup as dead_tuples,
  n_live_tup as live_tuples,
  CASE 
    WHEN n_live_tup > 0 THEN ROUND(100.0 * n_dead_tup / n_live_tup, 2)
    ELSE 0
  END as dead_tuple_percent,
  last_vacuum,
  last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND n_dead_tup > 1000
ORDER BY n_dead_tup DESC;

-- 6. Optimize large text columns (if any)
-- Check for large text columns that could be compressed
SELECT 
  table_name,
  column_name,
  data_type,
  character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND data_type IN ('text', 'character varying')
  AND table_name IN ('hr_contracts', 'users', 'contract_sections')
ORDER BY table_name, column_name;












