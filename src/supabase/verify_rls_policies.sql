-- Verify RLS policies to check for recursion issues
-- Run this to see the actual policy expressions

-- Check user_roles policies with expressions
SELECT 
    'user_roles' as table_name,
    policyname,
    cmd as command,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies 
WHERE schemaname = 'public' 
    AND tablename = 'user_roles'
ORDER BY policyname;

-- Check business_users policies with expressions
SELECT 
    'business_users' as table_name,
    policyname,
    cmd as command,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies 
WHERE schemaname = 'public' 
    AND tablename = 'business_users'
ORDER BY policyname;

-- Check if any policies reference business_users table (this could cause recursion)
SELECT 
    schemaname,
    tablename,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE schemaname = 'public'
    AND (
        qual::text LIKE '%business_users%' 
        OR with_check::text LIKE '%business_users%'
    )
ORDER BY tablename, policyname;

-- Check if any policies reference user_roles table (this could cause recursion)
SELECT 
    schemaname,
    tablename,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE schemaname = 'public'
    AND (
        qual::text LIKE '%user_roles%' 
        OR with_check::text LIKE '%user_roles%'
    )
ORDER BY tablename, policyname;
