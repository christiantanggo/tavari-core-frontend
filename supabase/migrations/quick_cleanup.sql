-- Quick cleanup - run these one at a time, check results first
-- These are safe and will free up space quickly

-- 1. Check how many old drafts exist (safe query)
SELECT COUNT(*) as old_drafts
FROM hr_contracts
WHERE status = 'draft' 
  AND created_at < NOW() - INTERVAL '90 days';

-- 2. Check PDF data size (safe query)
SELECT 
  COUNT(*) as contracts_with_pdfs,
  pg_size_pretty(SUM(LENGTH(pdf_data))) as pdf_size
FROM hr_contracts
WHERE pdf_data IS NOT NULL
LIMIT 1;

-- 3. Delete old drafts (ONLY if count looks reasonable)
-- Uncomment after reviewing the count from query 1
/*
DELETE FROM hr_contracts 
WHERE status = 'draft' 
  AND created_at < NOW() - INTERVAL '90 days';
*/

-- 4. Clear PDF data from old contracts (keeps metadata, removes binary)
-- Uncomment after reviewing query 2
/*
UPDATE hr_contracts
SET pdf_data = NULL
WHERE created_at < NOW() - INTERVAL '1 year'
  AND pdf_data IS NOT NULL;
*/












