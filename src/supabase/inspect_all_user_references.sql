-- ============================================
-- COMPREHENSIVE DATABASE INSPECTION
-- Find ALL tables and columns that reference users
-- ============================================

-- 1. Find ALL foreign key constraints that reference users table
SELECT 
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    tc.constraint_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND ccu.table_name = 'users'
ORDER BY tc.table_name, kcu.column_name;

-- 2. Find ALL foreign key constraints that reference auth.users table
SELECT 
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    tc.constraint_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'auth'
    AND ccu.table_name = 'users'
ORDER BY tc.table_name, kcu.column_name;

-- 3. Find ALL columns in public schema that contain 'user', 'employee', 'created_by', 'updated_by', etc.
SELECT 
    t.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable,
    CASE 
        WHEN pk.column_name IS NOT NULL THEN 'PRIMARY KEY'
        WHEN fk.constraint_name IS NOT NULL THEN 'FOREIGN KEY'
        ELSE ''
    END AS key_type
FROM information_schema.tables t
JOIN information_schema.columns c ON t.table_name = c.table_name AND t.table_schema = c.table_schema
LEFT JOIN (
    SELECT ku.table_name, ku.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage ku
        ON tc.constraint_name = ku.constraint_name
        AND tc.table_schema = ku.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
) pk ON t.table_name = pk.table_name AND c.column_name = pk.column_name
LEFT JOIN (
    SELECT ku.table_name, ku.column_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage ku
        ON tc.constraint_name = ku.constraint_name
        AND tc.table_schema = ku.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
) fk ON t.table_name = fk.table_name AND c.column_name = fk.column_name
WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND (
        LOWER(c.column_name) LIKE '%user%' OR
        LOWER(c.column_name) LIKE '%employee%' OR
        LOWER(c.column_name) LIKE '%created_by%' OR
        LOWER(c.column_name) LIKE '%updated_by%' OR
        LOWER(c.column_name) LIKE '%processed_by%' OR
        LOWER(c.column_name) LIKE '%scanned_by%' OR
        LOWER(c.column_name) LIKE '%printed_by%' OR
        LOWER(c.column_name) LIKE '%refunded_by%' OR
        LOWER(c.column_name) LIKE '%saved_by%' OR
        LOWER(c.column_name) LIKE '%added_by%' OR
        LOWER(c.column_name) LIKE '%paid_by%' OR
        LOWER(c.column_name) LIKE '%started_by%' OR
        LOWER(c.column_name) LIKE '%manager_id%' OR
        LOWER(c.column_name) LIKE '%approved_by%' OR
        LOWER(c.column_name) LIKE '%resolved_by%' OR
        LOWER(c.column_name) LIKE '%uploaded_by%' OR
        LOWER(c.column_name) LIKE '%adjusted_by%'
    )
ORDER BY t.table_name, c.column_name;

-- 4. Find ALL tables (not views) in public schema
SELECT 
    table_name,
    table_type
FROM information_schema.tables
WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- 5. Check for contract_compliance table structure specifically
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name = 'contract_compliance'
ORDER BY ordinal_position;

-- 6. Check ALL foreign keys FROM contract_compliance
SELECT 
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name = 'contract_compliance'
ORDER BY kcu.column_name;


