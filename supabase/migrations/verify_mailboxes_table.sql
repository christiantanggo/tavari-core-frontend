-- Verify mailboxes table exists and check structure
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'mailboxes'
ORDER BY ordinal_position;

-- Check if RLS is enabled
SELECT 
    tablename,
    rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'mailboxes';

-- Check RLS policies
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'mailboxes';

-- Try a simple query (this will fail if RLS is blocking)
-- Run this as the authenticated user to test RLS
SELECT COUNT(*) as mailbox_count FROM mailboxes;










