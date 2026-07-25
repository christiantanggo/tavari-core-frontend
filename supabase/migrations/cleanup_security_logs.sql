-- CRITICAL: Cleanup tavari_admin_security_logs table (44GB!)
-- This table is consuming 5x the database size limit

-- 1. Check current log count and date range
SELECT 
  COUNT(*) as total_logs,
  MIN(created_at) as oldest_log,
  MAX(created_at) as newest_log,
  pg_size_pretty(pg_total_relation_size('public.tavari_admin_security_logs')) as table_size
FROM tavari_admin_security_logs;

-- 2. Check logs by date (to see distribution)
SELECT 
  DATE(created_at) as log_date,
  COUNT(*) as log_count
FROM tavari_admin_security_logs
GROUP BY DATE(created_at)
ORDER BY log_date DESC
LIMIT 30;

-- 3. Check logs older than 90 days (safe to delete)
SELECT 
  COUNT(*) as logs_older_than_90_days,
  pg_size_pretty(SUM(pg_column_size(tavari_admin_security_logs.*))) as estimated_size
FROM tavari_admin_security_logs
WHERE created_at < NOW() - INTERVAL '90 days';

-- 4. Check logs older than 30 days (more aggressive cleanup)
SELECT 
  COUNT(*) as logs_older_than_30_days,
  pg_size_pretty(SUM(pg_column_size(tavari_admin_security_logs.*))) as estimated_size
FROM tavari_admin_security_logs
WHERE created_at < NOW() - INTERVAL '30 days';

-- 5. DELETE old logs (UNCOMMENT AFTER REVIEWING COUNTS ABOVE)
-- Option A: Keep last 90 days (recommended)
/*
DELETE FROM tavari_admin_security_logs
WHERE created_at < NOW() - INTERVAL '90 days';
*/

-- Option B: Keep last 30 days (more aggressive - will free more space)
/*
DELETE FROM tavari_admin_security_logs
WHERE created_at < NOW() - INTERVAL '30 days';
*/

-- Option C: Keep only last 7 days (most aggressive - frees maximum space)
/*
DELETE FROM tavari_admin_security_logs
WHERE created_at < NOW() - INTERVAL '7 days';
*/

-- 6. After deletion, vacuum to reclaim space
-- VACUUM FULL tavari_admin_security_logs;

-- 7. Add index on created_at for faster cleanup queries (if not exists)
CREATE INDEX IF NOT EXISTS idx_tavari_admin_security_logs_created_at 
ON tavari_admin_security_logs(created_at);

-- 8. Create a function to auto-cleanup old logs (run daily)
CREATE OR REPLACE FUNCTION cleanup_old_security_logs()
RETURNS void AS $$
BEGIN
  -- Delete logs older than 90 days
  DELETE FROM tavari_admin_security_logs
  WHERE created_at < NOW() - INTERVAL '90 days';
  
  -- Vacuum the table
  VACUUM ANALYZE tavari_admin_security_logs;
END;
$$ LANGUAGE plpgsql;












