-- Inspect pos_modifier_group_items table structure
-- This will help us understand how to store recipe ingredients

-- 1. Get table structure
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default,
    ordinal_position
FROM information_schema.columns 
WHERE table_schema = 'public' 
    AND table_name = 'pos_modifier_group_items'
ORDER BY ordinal_position;

-- 2. Get all constraints (foreign keys, check constraints, etc.)
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
    AND tc.table_name = 'pos_modifier_group_items'
ORDER BY tc.constraint_type, tc.constraint_name;

-- 3. Check if there's an ingredient_id column or similar
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
    AND table_name = 'pos_modifier_group_items'
    AND (
        column_name LIKE '%ingredient%' 
        OR column_name LIKE '%recipe%'
    );

-- 4. Sample data from existing recipe items (if any)
SELECT *
FROM pos_modifier_group_items pmgi
INNER JOIN pos_modifier_groups pmg ON pmgi.modifier_group_id = pmg.id
WHERE pmg.group_type = 'recipe_dish'
LIMIT 5;

-- 5. Check what foreign keys exist
SELECT 
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name = 'pos_modifier_group_items';
