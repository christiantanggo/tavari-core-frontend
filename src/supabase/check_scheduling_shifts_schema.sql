-- Check current schema of scheduling_shifts table
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'scheduling_shifts'
AND table_schema = 'public'
ORDER BY ordinal_position;

