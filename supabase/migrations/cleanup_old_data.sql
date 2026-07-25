-- Cleanup old and unused data to free up space
-- Run these carefully and review what will be deleted first

-- 1. Archive old contracts (move PDFs to storage instead of database)
-- First, check how much space PDFs are using:
SELECT 
  COUNT(*) as contracts_with_pdfs,
  pg_size_pretty(SUM(LENGTH(pdf_data))) as pdf_data_size
FROM hr_contracts
WHERE pdf_data IS NOT NULL;

-- 2. Delete old draft contracts (older than 90 days)
-- REVIEW THIS BEFORE RUNNING - Uncomment to execute
/*
DELETE FROM contract_sections 
WHERE contract_id IN (
  SELECT id FROM hr_contracts 
  WHERE status = 'draft' 
    AND created_at < NOW() - INTERVAL '90 days'
);

DELETE FROM hr_contracts 
WHERE status = 'draft' 
  AND created_at < NOW() - INTERVAL '90 days';
*/

-- 3. Archive old payroll runs (older than 2 years) - move to storage or delete
-- REVIEW THIS BEFORE RUNNING
/*
-- First check how many will be deleted
SELECT COUNT(*) as old_payroll_runs
FROM hrpayroll_runs
WHERE created_at < NOW() - INTERVAL '2 years';

-- Delete old payroll entries first (foreign key constraint)
DELETE FROM hrpayroll_entries
WHERE payroll_run_id IN (
  SELECT id FROM hrpayroll_runs
  WHERE created_at < NOW() - INTERVAL '2 years'
);

-- Then delete old payroll runs
DELETE FROM hrpayroll_runs
WHERE created_at < NOW() - INTERVAL '2 years';
*/

-- 4. Clear PDF data from old contracts (keep metadata, remove binary data)
-- This will free up significant space if PDFs are stored in the database
-- REVIEW THIS BEFORE RUNNING
/*
UPDATE hr_contracts
SET pdf_data = NULL,
    signed_pdf_data = NULL
WHERE created_at < NOW() - INTERVAL '1 year'
  AND (pdf_data IS NOT NULL OR signed_pdf_data IS NOT NULL);
*/

-- 5. Vacuum to reclaim space after deletions
-- Run this after any deletions
VACUUM ANALYZE;

-- 6. Check for duplicate or orphaned records
SELECT 
  'Orphaned contract_sections' as issue,
  COUNT(*) as count
FROM contract_sections cs
LEFT JOIN hr_contracts hc ON cs.contract_id = hc.id
WHERE hc.id IS NULL
UNION ALL
SELECT 
  'Orphaned payroll_entries' as issue,
  COUNT(*) as count
FROM hrpayroll_entries pe
LEFT JOIN hrpayroll_runs pr ON pe.payroll_run_id = pr.id
WHERE pr.id IS NULL
UNION ALL
SELECT 
  'Users without business link' as issue,
  COUNT(*) as count
FROM users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
WHERE ur.id IS NULL
  AND u.employment_status != 'terminated';












