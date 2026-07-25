-- Comprehensive Database Schema Report
-- Shows all tables, columns, RLS policies, indexes, and foreign keys
-- Run this in Supabase SQL Editor or pgAdmin

-- ============================================
-- 1. ALL TABLES WITH COLUMN INFORMATION
-- ============================================
SELECT 
    t.table_schema,
    t.table_name,
    c.column_name,
    c.data_type,
    c.character_maximum_length,
    c.is_nullable,
    c.column_default,
    CASE 
        WHEN pk.column_name IS NOT NULL THEN 'YES'
        ELSE 'NO'
    END AS is_primary_key
FROM 
    information_schema.tables t
    LEFT JOIN information_schema.columns c ON t.table_name = c.table_name 
        AND t.table_schema = c.table_schema
    LEFT JOIN (
        SELECT ku.table_schema, ku.table_name, ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
            ON tc.constraint_name = ku.constraint_name
            AND tc.table_schema = ku.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
    ) pk ON c.table_name = pk.table_name 
        AND c.column_name = pk.column_name
        AND c.table_schema = pk.table_schema
WHERE 
    t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
ORDER BY 
    t.table_name, c.ordinal_position;

-- ============================================
-- 2. ALL TABLES (SUMMARY)
-- ============================================
SELECT 
    table_schema,
    table_name,
    (SELECT COUNT(*) 
     FROM information_schema.columns c2 
     WHERE c2.table_name = t.table_name 
     AND c2.table_schema = t.table_schema) AS column_count
FROM 
    information_schema.tables t
WHERE 
    table_schema = 'public'
    AND table_type = 'BASE TABLE'
ORDER BY 
    table_name;

-- ============================================
-- 3. ALL RLS POLICIES
-- ============================================
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd AS command_type,
    qual AS using_expression,
    with_check AS with_check_expression
FROM 
    pg_policies
WHERE 
    schemaname = 'public'
ORDER BY 
    tablename, policyname;

-- ============================================
-- 4. ALL INDEXES
-- ============================================
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM 
    pg_indexes
WHERE 
    schemaname = 'public'
ORDER BY 
    tablename, indexname;

-- ============================================
-- 5. ALL FOREIGN KEYS
-- ============================================
SELECT
    tc.table_schema,
    tc.table_name,
    tc.constraint_name,
    kcu.column_name,
    ccu.table_schema AS foreign_table_schema,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.update_rule,
    rc.delete_rule
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints AS rc
        ON tc.constraint_name = rc.constraint_name
        AND tc.table_schema = rc.constraint_schema
WHERE 
    tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
ORDER BY 
    tc.table_name, tc.constraint_name;

-- ============================================
-- 6. APP BUILDER TABLES SPECIFIC (FOCUSED VIEW)
-- ============================================
SELECT 
    'APP BUILDER TABLES' AS section,
    t.table_name,
    STRING_AGG(
        c.column_name || ' (' || c.data_type || 
        CASE 
            WHEN c.is_nullable = 'NO' THEN ', NOT NULL'
            ELSE ''
        END || ')',
        ', ' ORDER BY c.ordinal_position
    ) AS columns
FROM 
    information_schema.tables t
    JOIN information_schema.columns c ON t.table_name = c.table_name
WHERE 
    t.table_schema = 'public'
    AND t.table_name LIKE 'app_%'
    AND t.table_type = 'BASE TABLE'
GROUP BY 
    t.table_name
ORDER BY 
    t.table_name;

-- ============================================
-- 7. APP BUILDER RLS POLICIES (FOCUSED VIEW)
-- ============================================
SELECT 
    'APP BUILDER RLS POLICIES' AS section,
    tablename,
    policyname,
    cmd AS command_type,
    roles,
    CASE 
        WHEN qual IS NOT NULL THEN 'YES'
        ELSE 'NO'
    END AS has_using_clause,
    CASE 
        WHEN with_check IS NOT NULL THEN 'YES'
        ELSE 'NO'
    END AS has_with_check_clause
FROM 
    pg_policies
WHERE 
    schemaname = 'public'
    AND tablename LIKE 'app_%'
ORDER BY 
    tablename, policyname;

-- ============================================
-- 8. APP BUILDER FOREIGN KEYS (FOCUSED VIEW)
-- ============================================
SELECT
    'APP BUILDER FOREIGN KEYS' AS section,
    tc.table_name,
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS references_table,
    ccu.column_name AS references_column,
    rc.delete_rule
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints AS rc
        ON tc.constraint_name = rc.constraint_name
        AND tc.table_schema = rc.constraint_schema
WHERE 
    tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND (tc.table_name LIKE 'app_%' OR ccu.table_name LIKE 'app_%')
ORDER BY 
    tc.table_name, tc.constraint_name;

-- ============================================
-- 9. BUSINESS_MODULE_USAGE TABLE STRUCTURE
-- ============================================
SELECT 
    'BUSINESS_MODULE_USAGE TABLE' AS section,
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default
FROM 
    information_schema.columns
WHERE 
    table_schema = 'public'
    AND table_name = 'business_module_usage'
ORDER BY 
    ordinal_position;

-- ============================================
-- 10. ALL FUNCTIONS (INCLUDING APP BUILDER)
-- ============================================
SELECT 
    routine_schema,
    routine_name,
    routine_type,
    data_type AS return_type
FROM 
    information_schema.routines
WHERE 
    routine_schema = 'public'
    AND (routine_name LIKE 'appbuilder_%' OR routine_name LIKE 'app_%')
ORDER BY 
    routine_name;

-- ============================================
-- 11. ALL TRIGGERS
-- ============================================
SELECT 
    trigger_schema,
    trigger_name,
    event_object_table AS table_name,
    action_timing,
    event_manipulation AS event,
    action_statement
FROM 
    information_schema.triggers
WHERE 
    trigger_schema = 'public'
ORDER BY 
    event_object_table, trigger_name;

-- ============================================
-- 12. STORAGE BUCKETS (SUPABASE SPECIFIC)
-- ============================================
SELECT 
    name AS bucket_name,
    id,
    public AS is_public,
    file_size_limit,
    allowed_mime_types
FROM 
    storage.buckets
WHERE 
    name LIKE '%appbuilder%' OR name LIKE '%app%'
ORDER BY 
    name;

-- ============================================
-- 13. STORAGE POLICIES (SUPABASE SPECIFIC)
-- ============================================
SELECT 
    name AS policy_name,
    bucket_id,
    definition
FROM 
    storage.policies
WHERE 
    bucket_id IN (
        SELECT id FROM storage.buckets 
        WHERE name LIKE '%appbuilder%' OR name LIKE '%app%'
    )
ORDER BY 
    bucket_id, name;




