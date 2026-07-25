-- Check table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'scheduling_break_tracking'
ORDER BY ordinal_position;

-- Check foreign key constraints
SELECT
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'scheduling_break_tracking'
AND tc.constraint_type = 'FOREIGN KEY';

-- Check if table exists and show sample data
SELECT * FROM scheduling_break_tracking LIMIT 5;

-- Show the time_clock_id values in scheduling_time_clocks
SELECT id FROM scheduling_time_clocks WHERE id = 'a74af13c-ce59-46b3-aa55-b2ce0dc2563e';

