-- Diagnostic query to check if module_onboarding_status table exists and its structure
-- Run this in Supabase SQL Editor to see what's in your database

-- Check if table exists
SELECT 
    table_name,
    table_schema
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name = 'module_onboarding_status';

-- If table exists, show its structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'module_onboarding_status'
ORDER BY ordinal_position;

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
WHERE tablename = 'module_onboarding_status';

-- Check if RLS is enabled
SELECT 
    tablename,
    rowsecurity
FROM pg_tables
WHERE schemaname = 'public' 
  AND tablename = 'module_onboarding_status';

-- Check for any data in the table (if it exists)
SELECT COUNT(*) as record_count
FROM module_onboarding_status;



