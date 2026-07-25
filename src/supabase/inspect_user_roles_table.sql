-- Comprehensive inspection of user_roles table
-- Run these queries to diagnose the 406 error

-- 1. Check if table exists and get basic info
SELECT 
    table_name,
    table_type,
    table_schema
FROM information_schema.tables 
WHERE table_schema = 'public' 
    AND table_name = 'user_roles';

-- 2. Get complete table structure (columns, data types, constraints)
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default,
    ordinal_position
FROM information_schema.columns 
WHERE table_schema = 'public' 
    AND table_name = 'user_roles'
ORDER BY ordinal_position;

-- 3. Get all constraints (primary keys, foreign keys, unique, check)
SELECT 
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
LEFT JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
LEFT JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.table_schema = 'public' 
    AND tc.table_name = 'user_roles'
ORDER BY tc.constraint_type, tc.constraint_name;

-- 4. Check if RLS is enabled
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
    AND tablename = 'user_roles';

-- 5. Get all RLS policies on user_roles table
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd as command,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies 
WHERE schemaname = 'public' 
    AND tablename = 'user_roles'
ORDER BY policyname;

-- 6. Get indexes on the table
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
    AND tablename = 'user_roles'
ORDER BY indexname;

-- 7. Check table privileges
SELECT 
    grantee,
    privilege_type,
    is_grantable
FROM information_schema.role_table_grants 
WHERE table_schema = 'public' 
    AND table_name = 'user_roles';

-- 8. Sample data (if any exists - limit to 10 rows for safety)
SELECT *
FROM user_roles 
LIMIT 10;

-- 9. Count total rows
SELECT COUNT(*) as total_rows 
FROM user_roles;

-- 10. Check if specific user_id exists
SELECT COUNT(*) as user_count
FROM user_roles 
WHERE user_id = 'e861f114-7a95-47c3-a4ca-465e7c405aac';

-- 11. Check for specific user_id with business_id
SELECT *
FROM user_roles 
WHERE user_id = 'e861f114-7a95-47c3-a4ca-465e7c405aac'
    AND business_id = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

-- 12. Check PostgREST query format - verify column names are correct
SELECT 
    column_name,
    data_type,
    CASE 
        WHEN data_type IN ('character varying', 'text') THEN 'TEXT'
        WHEN data_type = 'uuid' THEN 'UUID'
        WHEN data_type = 'boolean' THEN 'BOOLEAN'
        WHEN data_type = 'integer' THEN 'INTEGER'
        WHEN data_type = 'timestamp with time zone' THEN 'TIMESTAMPTZ'
        ELSE 'OTHER'
    END as postgrest_type
FROM information_schema.columns 
WHERE table_schema = 'public' 
    AND table_name = 'user_roles'
ORDER BY ordinal_position;
