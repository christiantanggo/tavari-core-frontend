-- Verify module_onboarding_status is accessible via Supabase REST API
-- Run this to check if the table is properly exposed

-- Check table exists in public schema
SELECT 
    schemaname,
    tablename,
    tableowner
FROM pg_tables
WHERE schemaname = 'public' 
  AND tablename = 'module_onboarding_status';

-- Check if table is in the correct schema for API access
SELECT 
    table_schema,
    table_name,
    table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'module_onboarding_status';

-- Verify all columns exist
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'module_onboarding_status'
ORDER BY ordinal_position;

-- Check current RLS policies
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd
FROM pg_policies
WHERE tablename = 'module_onboarding_status';

-- Test query to see if we can select (this should work if RLS is correct)
-- Replace 'YOUR_USER_ID' with an actual user ID from your auth.users table
SELECT COUNT(*) as can_access
FROM module_onboarding_status
WHERE business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';



