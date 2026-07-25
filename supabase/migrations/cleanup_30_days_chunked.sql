-- Cleanup logs older than 30 days in chunks
-- This is the most aggressive cleanup and will free the most space
-- Run this AFTER the high-volume day cleanup

DO $$
DECLARE
  deleted_count INTEGER;
  total_deleted INTEGER := 0;
  batch_num INTEGER := 0;
  start_time TIMESTAMP;
BEGIN
  start_time := clock_timestamp();
  
  RAISE NOTICE 'Starting 30-day cleanup at %', start_time;
  
  LOOP
    batch_num := batch_num + 1;
    
    -- Delete in chunks of 10,000
    DELETE FROM tavari_admin_security_logs
    WHERE created_at < NOW() - INTERVAL '30 days'
    AND ctid IN (
      SELECT ctid FROM tavari_admin_security_logs
      WHERE created_at < NOW() - INTERVAL '30 days'
      LIMIT 10000
    );
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    total_deleted := total_deleted + deleted_count;
    
    -- Exit if no more rows to delete
    EXIT WHEN deleted_count = 0;
    
    -- Log progress every 10 batches
    IF batch_num % 10 = 0 THEN
      RAISE NOTICE 'Batch %: Deleted % rows (total: %). Elapsed: %', 
        batch_num, 
        deleted_count, 
        total_deleted,
        clock_timestamp() - start_time;
    END IF;
    
    -- Small delay to prevent overwhelming the database
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE 'Completed 30-day cleanup: Deleted % total rows in % batches. Total time: %', 
    total_deleted, 
    batch_num,
    clock_timestamp() - start_time;
END $$;

-- Check results
SELECT 
  COUNT(*) as remaining_logs,
  MIN(created_at) as oldest_log,
  MAX(created_at) as newest_log,
  pg_size_pretty(pg_total_relation_size('public.tavari_admin_security_logs')) as table_size
FROM tavari_admin_security_logs;












