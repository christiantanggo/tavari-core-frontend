-- ============================================
-- COMPLETE DATABASE SCHEMA REPORT
-- Shows ALL tables, columns, RLS policies, indexes, and foreign keys
-- Run this in Supabase SQL Editor or pgAdmin
-- ============================================

-- ============================================
-- 1. ALL TABLES WITH FULL COLUMN INFORMATION
-- ============================================
SELECT 
    t.table_schema,
    t.table_name,
    c.column_name,
    c.ordinal_position,
    c.data_type,
    c.character_maximum_length,
    c.numeric_precision,
    c.numeric_scale,
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
-- 2. TABLE SUMMARY (ALL TABLES)
-- ============================================
SELECT 
    table_schema,
    table_name,
    (SELECT COUNT(*) 
     FROM information_schema.columns c2 
     WHERE c2.table_name = t.table_name 
     AND c2.table_schema = t.table_schema) AS column_count,
    (SELECT COUNT(*) 
     FROM information_schema.table_constraints tc2
     WHERE tc2.table_name = t.table_name 
     AND tc2.table_schema = t.table_schema
     AND tc2.constraint_type = 'PRIMARY KEY') AS primary_key_count,
    (SELECT COUNT(*) 
     FROM information_schema.table_constraints tc3
     WHERE tc3.table_name = t.table_name 
     AND tc3.table_schema = t.table_schema
     AND tc3.constraint_type = 'FOREIGN KEY') AS foreign_key_count
FROM 
    information_schema.tables t
WHERE 
    table_schema = 'public'
    AND table_type = 'BASE TABLE'
ORDER BY 
    table_name;

-- ============================================
-- 3. ALL RLS POLICIES (COMPLETE)
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
-- 4. RLS POLICY SUMMARY BY TABLE
-- ============================================
SELECT 
    tablename,
    COUNT(*) AS policy_count,
    STRING_AGG(DISTINCT cmd::text, ', ' ORDER BY cmd::text) AS command_types,
    STRING_AGG(DISTINCT roles::text, ', ' ORDER BY roles::text) AS roles
FROM 
    pg_policies
WHERE 
    schemaname = 'public'
GROUP BY 
    tablename
ORDER BY 
    tablename;

-- ============================================
-- 5. ALL INDEXES (COMPLETE)
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
-- 6. INDEX SUMMARY BY TABLE
-- ============================================
SELECT 
    tablename,
    COUNT(*) AS index_count,
    STRING_AGG(indexname, ', ' ORDER BY indexname) AS index_names
FROM 
    pg_indexes
WHERE 
    schemaname = 'public'
GROUP BY 
    tablename
ORDER BY 
    tablename;

-- ============================================
-- 7. ALL FOREIGN KEYS (COMPLETE)
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
-- 8. FOREIGN KEY SUMMARY BY TABLE
-- ============================================
SELECT
    tc.table_name,
    COUNT(*) AS foreign_key_count,
    STRING_AGG(
        kcu.column_name || ' → ' || ccu.table_name || '.' || ccu.column_name,
        ', ' ORDER BY tc.constraint_name
    ) AS foreign_key_relationships
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
GROUP BY 
    tc.table_name
ORDER BY 
    tc.table_name;

-- ============================================
-- 9. ALL PRIMARY KEYS
-- ============================================
SELECT
    tc.table_schema,
    tc.table_name,
    tc.constraint_name,
    STRING_AGG(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS primary_key_columns
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
WHERE 
    tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema = 'public'
GROUP BY 
    tc.table_schema, tc.table_name, tc.constraint_name
ORDER BY 
    tc.table_name;

-- ============================================
-- 10. ALL UNIQUE CONSTRAINTS
-- ============================================
SELECT
    tc.table_schema,
    tc.table_name,
    tc.constraint_name,
    STRING_AGG(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS unique_columns
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
WHERE 
    tc.constraint_type = 'UNIQUE'
    AND tc.table_schema = 'public'
ORDER BY 
    tc.table_name, tc.constraint_name;

-- ============================================
-- 11. ALL CHECK CONSTRAINTS
-- ============================================
SELECT
    tc.table_schema,
    tc.table_name,
    tc.constraint_name,
    cc.check_clause
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.check_constraints AS cc
        ON tc.constraint_name = cc.constraint_name
        AND tc.table_schema = cc.constraint_schema
WHERE 
    tc.constraint_type = 'CHECK'
    AND tc.table_schema = 'public'
ORDER BY 
    tc.table_name, tc.constraint_name;

-- ============================================
-- 12. ALL FUNCTIONS (STORED PROCEDURES)
-- ============================================
SELECT 
    routine_schema,
    routine_name,
    routine_type,
    data_type AS return_type,
    routine_definition
FROM 
    information_schema.routines
WHERE 
    routine_schema = 'public'
ORDER BY 
    routine_name;

-- ============================================
-- 13. ALL TRIGGERS
-- ============================================
SELECT 
    trigger_schema,
    trigger_name,
    event_object_table AS table_name,
    action_timing,
    event_manipulation AS event,
    action_statement,
    action_orientation
FROM 
    information_schema.triggers
WHERE 
    trigger_schema = 'public'
ORDER BY 
    event_object_table, trigger_name;

-- ============================================
-- 14. TRIGGER SUMMARY BY TABLE
-- ============================================
SELECT 
    event_object_table AS table_name,
    COUNT(*) AS trigger_count,
    STRING_AGG(
        trigger_name || ' (' || action_timing || ' ' || event_manipulation || ')',
        ', ' ORDER BY trigger_name
    ) AS triggers
FROM 
    information_schema.triggers
WHERE 
    trigger_schema = 'public'
GROUP BY 
    event_object_table
ORDER BY 
    event_object_table;

-- ============================================
-- 15. ALL VIEWS
-- ============================================
SELECT 
    table_schema,
    table_name AS view_name,
    view_definition
FROM 
    information_schema.views
WHERE 
    table_schema = 'public'
ORDER BY 
    table_name;

-- ============================================
-- 16. STORAGE BUCKETS (SUPABASE SPECIFIC)
-- ============================================
SELECT 
    name AS bucket_name,
    id,
    public AS is_public,
    file_size_limit,
    allowed_mime_types,
    created_at,
    updated_at
FROM 
    storage.buckets
ORDER BY 
    name;

-- ============================================
-- 17. STORAGE POLICIES (SUPABASE SPECIFIC)
-- ============================================
SELECT 
    sp.name AS policy_name,
    sp.bucket_id,
    b.name AS bucket_name,
    sp.definition,
    sp.check_expression,
    sp.role
FROM 
    storage.policies sp
    JOIN storage.buckets b ON sp.bucket_id = b.id
ORDER BY 
    b.name, sp.name;

-- ============================================
-- 18. TABLE SIZES AND STATISTICS
-- ============================================
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - 
                   pg_relation_size(schemaname||'.'||tablename)) AS indexes_size,
    (SELECT n_live_tup 
     FROM pg_stat_user_tables 
     WHERE schemaname = t.schemaname 
     AND relname = t.tablename) AS row_count
FROM 
    pg_tables t
WHERE 
    schemaname = 'public'
ORDER BY 
    pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- ============================================
-- 19. COLUMN STATISTICS (NULLABLE, DEFAULT VALUES)
-- ============================================
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default,
    CASE 
        WHEN column_default IS NOT NULL THEN 'YES'
        ELSE 'NO'
    END AS has_default
FROM 
    information_schema.columns
WHERE 
    table_schema = 'public'
ORDER BY 
    table_name, ordinal_position;

-- ============================================
-- 20. ENUMS AND CUSTOM TYPES
-- ============================================
SELECT 
    t.typname AS type_name,
    t.typtype AS type_type,
    STRING_AGG(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS enum_values
FROM 
    pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
WHERE 
    t.typname NOT LIKE 'pg_%'
    AND t.typname NOT LIKE '_%'
GROUP BY 
    t.typname, t.typtype
ORDER BY 
    t.typname;

-- ============================================
-- 21. COMPLETE TABLE RELATIONSHIP MAP
-- ============================================
SELECT
    'TABLE: ' || tc.table_name AS source,
    'REFERENCES: ' || ccu.table_name AS target,
    kcu.column_name AS source_column,
    ccu.column_name AS target_column,
    rc.delete_rule,
    rc.update_rule
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
    tc.table_name, ccu.table_name;

-- ============================================
-- 22. RLS STATUS BY TABLE (ENABLED/DISABLED)
-- ============================================
SELECT 
    schemaname,
    tablename,
    CASE 
        WHEN rowsecurity THEN 'ENABLED'
        ELSE 'DISABLED'
    END AS rls_status,
    (SELECT COUNT(*) 
     FROM pg_policies p 
     WHERE p.tablename = t.tablename 
     AND p.schemaname = t.schemaname) AS policy_count
FROM 
    pg_tables t
WHERE 
    schemaname = 'public'
ORDER BY 
    tablename;

-- ============================================
-- 23. COMPLETE DATABASE SUMMARY
-- ============================================
SELECT 
    'DATABASE SUMMARY' AS section,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS total_tables,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public') AS total_columns,
    (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') AS total_rls_policies,
    (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public') AS total_indexes,
    (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = 'public' AND constraint_type = 'FOREIGN KEY') AS total_foreign_keys,
    (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public') AS total_functions,
    (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = 'public') AS total_triggers,
    (SELECT COUNT(*) FROM information_schema.views WHERE table_schema = 'public') AS total_views,
    (SELECT COUNT(*) FROM storage.buckets) AS total_storage_buckets;




