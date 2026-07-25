-- Set up automatic log retention policy
-- This will prevent logs from growing unbounded

-- 1. Create function to clean up old security logs (keep 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_security_logs()
RETURNS void AS $$
BEGIN
  -- Delete logs older than 90 days
  DELETE FROM tavari_admin_security_logs
  WHERE created_at < NOW() - INTERVAL '90 days';
  
  RAISE NOTICE 'Cleaned up old security logs';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create function to clean up other log tables
CREATE OR REPLACE FUNCTION cleanup_old_logs()
RETURNS void AS $$
BEGIN
  -- Clean up music system logs (keep 30 days)
  DELETE FROM music_system_logs
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  -- Clean up music playback logs (keep 30 days)
  DELETE FROM music_v2_playback_logs
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  -- Clean up user recent activity (keep 30 days)
  DELETE FROM user_recent_activity
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  -- Clean up audit logs (keep 90 days)
  DELETE FROM audit_logs
  WHERE created_at < NOW() - INTERVAL '90 days';
  
  RAISE NOTICE 'Cleaned up old logs';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Schedule automatic cleanup (requires pg_cron extension)
-- If pg_cron is enabled, this will run daily at 2 AM
/*
SELECT cron.schedule(
  'cleanup-old-logs',
  '0 2 * * *',  -- Daily at 2 AM
  $$SELECT cleanup_old_security_logs(); SELECT cleanup_old_logs();$$
);
*/

-- 4. Add indexes for faster cleanup queries
CREATE INDEX IF NOT EXISTS idx_tavari_admin_security_logs_created_at 
ON tavari_admin_security_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_music_system_logs_created_at 
ON music_system_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_music_v2_playback_logs_created_at 
ON music_v2_playback_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_user_recent_activity_created_at 
ON user_recent_activity(created_at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at 
ON audit_logs(created_at);












