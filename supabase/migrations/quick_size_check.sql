-- Quick size check - lightweight queries that won't timeout
-- Run these one at a time

-- 1. Just the total size (fastest)
SELECT pg_size_pretty(pg_database_size(current_database())) as total_size;

-- 2. Top 5 largest tables (simplified)
SELECT 
  tablename,
  pg_size_pretty(pg_total_relation_size('public.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size('public.'||tablename) DESC
LIMIT 5;












