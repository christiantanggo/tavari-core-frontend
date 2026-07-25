-- Database Diagnostic Script
-- Run this to see the current state of your database before making changes
-- This helps avoid errors from missing tables, columns, or policies

-- ============================================================================
-- 1. CHECK IF KEY TABLES EXIST
-- ============================================================================
SELECT 
    'TABLE CHECK' as section,
    table_schema,
    table_name,
    CASE 
        WHEN table_name IN ('hr_contracts', 'users', 'businesses', 'user_roles') 
        THEN '✅ EXISTS'
        ELSE '⚠️ OTHER TABLE'
    END as status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND (
    table_name IN ('hr_contracts', 'users', 'businesses', 'user_roles')
    OR table_name LIKE 'hr_%'
  )
ORDER BY 
    CASE WHEN table_name IN ('hr_contracts', 'users', 'businesses', 'user_roles') THEN 0 ELSE 1 END,
    table_name;

-- ============================================================================
-- 2. CHECK HR_CONTRACTS TABLE STRUCTURE (if it exists)
-- ============================================================================
SELECT 
    'HR_CONTRACTS COLUMNS' as section,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'hr_contracts'
ORDER BY ordinal_position;

-- ============================================================================
-- 3. CHECK USERS TABLE STRUCTURE (if it exists)
-- ============================================================================
SELECT 
    'USERS COLUMNS' as section,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND (
    column_name LIKE '%personal%'
    OR column_name LIKE '%sin%'
    OR column_name LIKE '%emergency%'
    OR column_name LIKE '%address%'
    OR column_name IN ('email', 'first_name', 'last_name', 'phone', 'birthdate')
  )
ORDER BY column_name;

-- ============================================================================
-- 4. CHECK IF PERSONAL_INFO_TOKEN COLUMN EXISTS
-- ============================================================================
SELECT 
    'PERSONAL_INFO_TOKEN CHECK' as section,
    table_name,
    column_name,
    data_type,
    '✅ EXISTS' as status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'personal_info_token'
ORDER BY table_name;

-- ============================================================================
-- 5. CHECK RLS POLICIES FOR HR_CONTRACTS (if table exists)
-- ============================================================================
SELECT 
    'HR_CONTRACTS RLS POLICIES' as section,
    policyname,
    cmd as command,
    roles,
    qual as using_expression,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'hr_contracts'
ORDER BY cmd, policyname;

-- ============================================================================
-- 6. CHECK RLS POLICIES FOR USERS (if table exists)
-- ============================================================================
SELECT 
    'USERS RLS POLICIES' as section,
    policyname,
    cmd as command,
    roles,
    qual as using_expression,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'users'
  AND (
    policyname LIKE '%personal_info%'
    OR policyname LIKE '%token%'
  )
ORDER BY cmd, policyname;

-- ============================================================================
-- 7. CHECK IF RLS IS ENABLED ON TABLES
-- ============================================================================
SELECT 
    'RLS STATUS' as section,
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('hr_contracts', 'users')
ORDER BY tablename;

-- ============================================================================
-- 8. CHECK INDEXES ON PERSONAL_INFO_TOKEN (if column exists)
-- ============================================================================
SELECT 
    'PERSONAL_INFO_TOKEN INDEXES' as section,
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (
    indexname LIKE '%personal_info_token%'
    OR indexdef LIKE '%personal_info_token%'
  )
ORDER BY tablename, indexname;

-- ============================================================================
-- 9. CHECK FOR CONTRACT-RELATED TABLES
-- ============================================================================
SELECT 
    'CONTRACT TABLES' as section,
    table_name,
    'Table exists' as status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE '%contract%'
ORDER BY table_name;

-- ============================================================================
-- 10. SUMMARY - WHAT'S MISSING
-- ============================================================================
SELECT 
    'SUMMARY' as section,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'hr_contracts')
        THEN '✅ hr_contracts table exists'
        ELSE '❌ hr_contracts table MISSING'
    END as hr_contracts_status,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users')
        THEN '✅ users table exists'
        ELSE '❌ users table MISSING'
    END as users_status,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'hr_contracts' 
            AND column_name = 'personal_info_token'
        )
        THEN '✅ hr_contracts.personal_info_token column exists'
        ELSE '❌ hr_contracts.personal_info_token column MISSING'
    END as contract_token_status,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'users' 
            AND column_name = 'personal_info_token'
        )
        THEN '✅ users.personal_info_token column exists'
        ELSE '❌ users.personal_info_token column MISSING'
    END as users_token_status,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_policies 
            WHERE schemaname = 'public' 
            AND tablename = 'hr_contracts' 
            AND policyname LIKE '%personal_info%'
        )
        THEN '✅ hr_contracts personal_info RLS policies exist'
        ELSE '❌ hr_contracts personal_info RLS policies MISSING'
    END as contract_rls_status,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM pg_policies 
            WHERE schemaname = 'public' 
            AND tablename = 'users' 
            AND policyname LIKE '%personal_info%'
        )
        THEN '✅ users personal_info RLS policies exist'
        ELSE '❌ users personal_info RLS policies MISSING'
    END as users_rls_status;
















