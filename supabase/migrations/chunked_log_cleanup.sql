-- Chunked log cleanup - processes in batches to avoid timeouts
-- Run this instead of the full cleanup if it times out

-- Strategy: Delete in chunks of 10,000 rows at a time
-- This prevents timeouts and allows progress tracking

-- Step 1: Delete logs older than 90 days (small batch first)
DO $$
DECLARE
  deleted_count INTEGER;
  total_deleted INTEGER := 0;
BEGIN
  LOOP
    -- Delete in chunks of 10,000
    DELETE FROM tavari_admin_security_logs
    WHERE created_at < NOW() - INTERVAL '90 days'
    AND ctid IN (
      SELECT ctid FROM tavari_admin_security_logs
      WHERE created_at < NOW() - INTERVAL '90 days'
      LIMIT 10000
    );
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    total_deleted := total_deleted + deleted_count;
    
    -- Exit if no more rows to delete
    EXIT WHEN deleted_count = 0;
    
    -- Log progress
    RAISE NOTICE 'Deleted % rows (total: %). Continuing...', deleted_count, total_deleted;
    
    -- Small delay to prevent overwhelming the database
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE 'Completed: Deleted % total rows older than 90 days', total_deleted;
END $$;

-- Step 2: Delete high-volume days (Nov 25, Nov 18, Nov 26) - these are likely debug/test days
-- Nov 25: 485,556 logs
-- Nov 18: 211,270 logs  
-- Nov 26: 167,161 logs

DO $$
DECLARE
  deleted_count INTEGER;
  total_deleted INTEGER := 0;
  target_date DATE;
BEGIN
  -- Delete Nov 25, 2025 (485K logs)
  target_date := '2025-11-25';
  
  LOOP
    DELETE FROM tavari_admin_security_logs
    WHERE DATE(created_at) = target_date
    AND ctid IN (
      SELECT ctid FROM tavari_admin_security_logs
      WHERE DATE(created_at) = target_date
      LIMIT 10000
    );
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    total_deleted := total_deleted + deleted_count;
    
    EXIT WHEN deleted_count = 0;
    
    RAISE NOTICE 'Deleted % rows from % (total: %). Continuing...', deleted_count, target_date, total_deleted;
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE 'Completed %: Deleted % total rows', target_date, total_deleted;
END $$;

-- Step 3: Delete Nov 18, 2025 (211K logs)
DO $$
DECLARE
  deleted_count INTEGER;
  total_deleted INTEGER := 0;
BEGIN
  LOOP
    DELETE FROM tavari_admin_security_logs
    WHERE DATE(created_at) = '2025-11-18'
    AND ctid IN (
      SELECT ctid FROM tavari_admin_security_logs
      WHERE DATE(created_at) = '2025-11-18'
      LIMIT 10000
    );
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    total_deleted := total_deleted + deleted_count;
    
    EXIT WHEN deleted_count = 0;
    
    RAISE NOTICE 'Deleted % rows from 2025-11-18 (total: %). Continuing...', deleted_count, total_deleted;
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE 'Completed 2025-11-18: Deleted % total rows', total_deleted;
END $$;

-- Step 4: Delete Nov 26, 2025 (167K logs)
DO $$
DECLARE
  deleted_count INTEGER;
  total_deleted INTEGER := 0;
BEGIN
  LOOP
    DELETE FROM tavari_admin_security_logs
    WHERE DATE(created_at) = '2025-11-26'
    AND ctid IN (
      SELECT ctid FROM tavari_admin_security_logs
      WHERE DATE(created_at) = '2025-11-26'
      LIMIT 10000
    );
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    total_deleted := total_deleted + deleted_count;
    
    EXIT WHEN deleted_count = 0;
    
    RAISE NOTICE 'Deleted % rows from 2025-11-26 (total: %). Continuing...', deleted_count, total_deleted;
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE 'Completed 2025-11-26: Deleted % total rows', total_deleted;
END $$;

-- Step 5: Delete logs older than 30 days (more aggressive cleanup)
-- This will free the most space
DO $$
DECLARE
  deleted_count INTEGER;
  total_deleted INTEGER := 0;
  batch_num INTEGER := 0;
BEGIN
  LOOP
    batch_num := batch_num + 1;
    
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
    
    -- Log every 10 batches
    IF batch_num % 10 = 0 THEN
      RAISE NOTICE 'Batch %: Deleted % rows (total: %). Continuing...', batch_num, deleted_count, total_deleted;
    END IF;
    
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE 'Completed 30-day cleanup: Deleted % total rows in % batches', total_deleted, batch_num;
END $$;

-- Step 6: Vacuum to reclaim space (run after deletions)
-- Note: VACUUM FULL locks the table, so run during low-traffic period
-- VACUUM ANALYZE tavari_admin_security_logs;

-- Step 7: Check new size
SELECT 
  COUNT(*) as remaining_logs,
  MIN(created_at) as oldest_log,
  MAX(created_at) as newest_log,
  pg_size_pretty(pg_total_relation_size('public.tavari_admin_security_logs')) as table_size
FROM tavari_admin_security_logs;












