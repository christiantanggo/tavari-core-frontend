-- ============================================
-- INSPECT TABLES FOR DELETION SCRIPT
-- ============================================
-- Run these queries to see what columns actually exist
-- ============================================

-- Check pos_loyalty_accounts table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
    AND table_name = 'pos_loyalty_accounts'
ORDER BY ordinal_position;

-- Check all tables that might reference users
SELECT 
    t.table_name,
    c.column_name,
    c.data_type
FROM information_schema.tables t
JOIN information_schema.columns c ON t.table_name = c.table_name
WHERE t.table_schema = 'public'
    AND (
        c.column_name LIKE '%user_id%' OR
        c.column_name LIKE '%employee_id%' OR
        c.column_name LIKE '%created_by%' OR
        c.column_name LIKE '%updated_by%' OR
        c.column_name LIKE '%processed_by%' OR
        c.column_name LIKE '%scanned_by%' OR
        c.column_name LIKE '%printed_by%' OR
        c.column_name LIKE '%refunded_by%' OR
        c.column_name LIKE '%saved_by%' OR
        c.column_name LIKE '%added_by%' OR
        c.column_name LIKE '%paid_by%' OR
        c.column_name LIKE '%started_by%' OR
        c.column_name LIKE '%manager_id%' OR
        c.column_name LIKE '%approved_by%' OR
        c.column_name LIKE '%resolved_by%' OR
        c.column_name LIKE '%uploaded_by%'
    )
    AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name, c.column_name;

-- Check for Daniel Jamieson records in key tables
SELECT 'users' as table_name, COUNT(*) as count 
FROM users 
WHERE LOWER(first_name || ' ' || last_name) LIKE '%daniel%jamieson%' 
    OR LOWER(email) LIKE '%daniel%jamieson%' 
    OR LOWER(email) LIKE '%jamieson%'
UNION ALL
SELECT 'business_users', COUNT(*) 
FROM business_users 
WHERE user_id IN (
    SELECT id FROM users 
    WHERE LOWER(first_name || ' ' || last_name) LIKE '%daniel%jamieson%' 
        OR LOWER(email) LIKE '%daniel%jamieson%' 
        OR LOWER(email) LIKE '%jamieson%'
)
UNION ALL
SELECT 'user_roles', COUNT(*) 
FROM user_roles 
WHERE user_id IN (
    SELECT id FROM users 
    WHERE LOWER(first_name || ' ' || last_name) LIKE '%daniel%jamieson%' 
        OR LOWER(email) LIKE '%daniel%jamieson%' 
        OR LOWER(email) LIKE '%jamieson%'
)
UNION ALL
SELECT 'hr_contracts', COUNT(*) 
FROM hr_contracts 
WHERE employee_email LIKE '%daniel%jamieson%' 
    OR employee_email LIKE '%jamieson%'
    OR employee_id IN (
        SELECT id FROM users 
        WHERE LOWER(first_name || ' ' || last_name) LIKE '%daniel%jamieson%' 
            OR LOWER(email) LIKE '%daniel%jamieson%' 
            OR LOWER(email) LIKE '%jamieson%'
    );


