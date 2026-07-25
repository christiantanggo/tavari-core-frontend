-- EMERGENCY: Immediate cleanup to free space
-- Run this FIRST to get database under 8GB limit
-- 
-- NOTE: If this times out, use chunked_log_cleanup.sql instead
-- which processes in batches of 10,000 rows

-- WARNING: This will delete logs older than 30 days
-- Review the counts first using cleanup_security_logs.sql

-- 1. Delete old security logs (30 days retention) - CHUNKED VERSION
-- This should free ~40GB immediately
-- If this times out, run chunked_log_cleanup.sql instead
DO $$
DECLARE
  deleted_count INTEGER;
  total_deleted INTEGER := 0;
BEGIN
  LOOP
    DELETE FROM tavari_admin_security_logs
    WHERE created_at < NOW() - INTERVAL '30 days'
    AND ctid IN (
      SELECT ctid FROM tavari_admin_security_logs
      WHERE created_at < NOW() - INTERVAL '30 days'
      LIMIT 10000
    );
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    total_deleted := total_deleted + deleted_count;
    
    EXIT WHEN deleted_count = 0;
    
    RAISE NOTICE 'Deleted % rows (total: %). Continuing...', deleted_count, total_deleted;
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE 'Completed: Deleted % total rows', total_deleted;
END $$;

-- 2. Delete old music logs (30 days retention)
DELETE FROM music_system_logs
WHERE created_at < NOW() - INTERVAL '30 days';

DELETE FROM music_v2_playback_logs
WHERE created_at < NOW() - INTERVAL '30 days';

-- 3. Delete old user activity (30 days retention)
DELETE FROM user_recent_activity
WHERE created_at < NOW() - INTERVAL '30 days';

-- 4. Delete old audit logs (90 days retention - keep longer for compliance)
DELETE FROM audit_logs
WHERE created_at < NOW() - INTERVAL '90 days';

-- 5. Vacuum to reclaim space immediately
VACUUM FULL tavari_admin_security_logs;
VACUUM FULL music_system_logs;
VACUUM FULL music_v2_playback_logs;
VACUUM FULL user_recent_activity;
VACUUM FULL audit_logs;

-- 6. Check new sizes
SELECT 
  'tavari_admin_security_logs' as table_name,
  pg_size_pretty(pg_total_relation_size('public.tavari_admin_security_logs')) as new_size
UNION ALL
SELECT 
  'music_system_logs' as table_name,
  pg_size_pretty(pg_total_relation_size('public.music_system_logs')) as new_size
UNION ALL
SELECT 
  'music_v2_playback_logs' as table_name,
  pg_size_pretty(pg_total_relation_size('public.music_v2_playback_logs')) as new_size
UNION ALL
SELECT 
  'user_recent_activity' as table_name,
  pg_size_pretty(pg_total_relation_size('public.user_recent_activity')) as new_size
UNION ALL
SELECT 
  'audit_logs' as table_name,
  pg_size_pretty(pg_total_relation_size('public.audit_logs')) as new_size;

