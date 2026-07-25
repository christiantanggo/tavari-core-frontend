-- Check which columns in hr_contracts are NOT NULL
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'hr_contracts'
  AND is_nullable = 'NO'
ORDER BY ordinal_position;










