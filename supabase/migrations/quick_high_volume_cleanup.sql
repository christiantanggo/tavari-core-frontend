-- Quick cleanup of highest volume days first
-- This targets the days with 100K+ logs to free space fastest

-- Delete Nov 25, 2025 (485,556 logs) - highest volume day
DO $$
DECLARE
  deleted_count INTEGER;
  total_deleted INTEGER := 0;
BEGIN
  LOOP
    DELETE FROM tavari_admin_security_logs
    WHERE DATE(created_at) = '2025-11-25'
    LIMIT 10000;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    total_deleted := total_deleted + deleted_count;
    
    EXIT WHEN deleted_count = 0;
    
    RAISE NOTICE 'Deleted % rows from 2025-11-25 (total: %). Continuing...', deleted_count, total_deleted;
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE 'Completed 2025-11-25: Deleted % total rows', total_deleted;
END $$;

-- Delete Nov 18, 2025 (211,270 logs)
DO $$
DECLARE
  deleted_count INTEGER;
  total_deleted INTEGER := 0;
BEGIN
  LOOP
    DELETE FROM tavari_admin_security_logs
    WHERE DATE(created_at) = '2025-11-18'
    LIMIT 10000;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    total_deleted := total_deleted + deleted_count;
    
    EXIT WHEN deleted_count = 0;
    
    RAISE NOTICE 'Deleted % rows from 2025-11-18 (total: %). Continuing...', deleted_count, total_deleted;
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE 'Completed 2025-11-18: Deleted % total rows', total_deleted;
END $$;

-- Delete Nov 26, 2025 (167,161 logs)
DO $$
DECLARE
  deleted_count INTEGER;
  total_deleted INTEGER := 0;
BEGIN
  LOOP
    DELETE FROM tavari_admin_security_logs
    WHERE DATE(created_at) = '2025-11-26'
    LIMIT 10000;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    total_deleted := total_deleted + deleted_count;
    
    EXIT WHEN deleted_count = 0;
    
    RAISE NOTICE 'Deleted % rows from 2025-11-26 (total: %). Continuing...', deleted_count, total_deleted;
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE 'Completed 2025-11-26: Deleted % total rows', total_deleted;
END $$;

-- Delete Nov 24, 2025 (149,494 logs)
DO $$
DECLARE
  deleted_count INTEGER;
  total_deleted INTEGER := 0;
BEGIN
  LOOP
    DELETE FROM tavari_admin_security_logs
    WHERE DATE(created_at) = '2025-11-24'
    LIMIT 10000;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    total_deleted := total_deleted + deleted_count;
    
    EXIT WHEN deleted_count = 0;
    
    RAISE NOTICE 'Deleted % rows from 2025-11-24 (total: %). Continuing...', deleted_count, total_deleted;
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE 'Completed 2025-11-24: Deleted % total rows', total_deleted;
END $$;

-- Check progress
SELECT 
  COUNT(*) as remaining_logs,
  pg_size_pretty(pg_total_relation_size('public.tavari_admin_security_logs')) as table_size
FROM tavari_admin_security_logs;












