-- Analyze database size and identify large tables
-- Run this in Supabase SQL Editor to see what's using space
-- Run queries ONE AT A TIME if you get timeouts

-- 1. Total database size (run this first - it's fast)
SELECT 
  pg_size_pretty(pg_database_size(current_database())) as total_database_size;

-- 2. Size by table (largest first) - Run this separately if query 1 works
-- If this times out, use quick_size_check.sql instead
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;

-- 3. Size by index
SELECT 
  schemaname,
  indexname,
  tablename,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  pg_relation_size(indexrelid) AS index_size_bytes
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;

-- 4. Row counts for large tables
SELECT 
  'users' as table_name,
  COUNT(*) as row_count,
  pg_size_pretty(pg_total_relation_size('public.users')) as size
FROM users
UNION ALL
SELECT 
  'hr_contracts' as table_name,
  COUNT(*) as row_count,
  pg_size_pretty(pg_total_relation_size('public.hr_contracts')) as size
FROM hr_contracts
UNION ALL
SELECT 
  'hrpayroll_runs' as table_name,
  COUNT(*) as row_count,
  pg_size_pretty(pg_total_relation_size('public.hrpayroll_runs')) as size
FROM hrpayroll_runs
UNION ALL
SELECT 
  'hrpayroll_entries' as table_name,
  COUNT(*) as row_count,
  pg_size_pretty(pg_total_relation_size('public.hrpayroll_entries')) as size
FROM hrpayroll_entries
UNION ALL
SELECT 
  'contract_sections' as table_name,
  COUNT(*) as row_count,
  pg_size_pretty(pg_total_relation_size('public.contract_sections')) as size
FROM contract_sections
UNION ALL
SELECT 
  'user_roles' as table_name,
  COUNT(*) as row_count,
  pg_size_pretty(pg_total_relation_size('public.user_roles')) as size
FROM user_roles
UNION ALL
SELECT 
  'business_users' as table_name,
  COUNT(*) as row_count,
  pg_size_pretty(pg_total_relation_size('public.business_users')) as size
FROM business_users
ORDER BY size DESC;

-- 5. Check for large binary data (PDFs, images, etc.)
SELECT 
  'hr_contracts.pdf_data' as column_name,
  COUNT(*) as rows_with_data,
  pg_size_pretty(SUM(LENGTH(pdf_data))) as total_size
FROM hr_contracts
WHERE pdf_data IS NOT NULL
UNION ALL
SELECT 
  'hr_contracts.signed_pdf_data' as column_name,
  COUNT(*) as rows_with_data,
  pg_size_pretty(SUM(LENGTH(signed_pdf_data))) as total_size
FROM hr_contracts
WHERE signed_pdf_data IS NOT NULL;

-- 6. Check for old/unused data
SELECT 
  'Old contracts (older than 1 year)' as description,
  COUNT(*) as count
FROM hr_contracts
WHERE created_at < NOW() - INTERVAL '1 year'
UNION ALL
SELECT 
  'Draft contracts (older than 90 days)' as description,
  COUNT(*) as count
FROM hr_contracts
WHERE status = 'draft' AND created_at < NOW() - INTERVAL '90 days'
UNION ALL
SELECT 
  'Terminated employees (older than 7 years)' as description,
  COUNT(*) as count
FROM users
WHERE employment_status = 'terminated' 
  AND termination_date < NOW() - INTERVAL '7 years';

