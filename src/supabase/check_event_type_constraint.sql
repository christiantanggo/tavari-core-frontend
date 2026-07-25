-- Check the event_type constraint
SELECT 
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'scheduling_events'::regclass
AND contype = 'c'
AND conname LIKE '%event_type%';

