-- Check what statuses are allowed in hr_contracts
SELECT 
  conname as constraint_name,
  pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conrelid = 'hr_contracts'::regclass
  AND contype = 'c'
  AND conname LIKE '%status%';










