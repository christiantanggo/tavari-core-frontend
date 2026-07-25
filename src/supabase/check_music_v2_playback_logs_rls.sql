-- Check current RLS policies for music_v2_playback_logs

-- 1. Check if RLS is enabled
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename = 'music_v2_playback_logs';

-- 2. List all existing policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd as command,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE schemaname = 'public' 
  AND tablename = 'music_v2_playback_logs'
ORDER BY policyname;

-- 3. Check table structure
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'music_v2_playback_logs'
ORDER BY ordinal_position;

-- 4. Check if there are any logs (to understand the data)
SELECT 
  COUNT(*) as total_logs,
  COUNT(DISTINCT business_id) as unique_businesses,
  COUNT(DISTINCT installation_id) as unique_installations,
  COUNT(DISTINCT device_id) as unique_devices,
  COUNT(DISTINCT location_id) as unique_locations,
  MIN(created_at) as oldest_log,
  MAX(created_at) as newest_log
FROM music_v2_playback_logs;

-- 5. Check sample of recent logs (if any)
SELECT 
  id,
  business_id,
  installation_id,
  device_id,
  location_id,
  log_type,
  created_at,
  synced_to_server
FROM music_v2_playback_logs
ORDER BY created_at DESC
LIMIT 10;


