-- Check RLS policies on scheduling_shifts table
SELECT * FROM pg_policies WHERE tablename = 'scheduling_shifts';

-- Check if RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'scheduling_shifts';

