-- Add ingredient_id column to pos_modifier_group_items table
-- This allows recipes (which use ingredients table) to be stored properly

-- Step 1: Add ingredient_id column (nullable, for recipes)
ALTER TABLE pos_modifier_group_items
ADD COLUMN IF NOT EXISTS ingredient_id UUID;

-- Step 2: Add foreign key constraint to ingredients table
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'pos_modifier_group_items_ingredient_id_fkey'
    ) THEN
        ALTER TABLE pos_modifier_group_items
        ADD CONSTRAINT pos_modifier_group_items_ingredient_id_fkey 
        FOREIGN KEY (ingredient_id) 
        REFERENCES ingredients(id) 
        ON DELETE CASCADE;
    END IF;
END $$;

-- Step 3: Check if we can make inventory_id nullable
-- First, let's see if there are any existing recipe items that don't have inventory_id
SELECT COUNT(*) as recipe_items_without_inventory
FROM pos_modifier_group_items pmgi
INNER JOIN pos_modifier_groups pmg ON pmgi.modifier_group_id = pmg.id
WHERE pmg.group_type = 'recipe_dish';

-- Check the foreign key constraint on inventory_id
SELECT 
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name = 'pos_modifier_group_items'
    AND kcu.column_name = 'inventory_id';

-- For recipes: We'll need to either:
-- Option A: Make inventory_id nullable (requires dropping NOT NULL constraint)
-- Option B: Create dummy pos_inventory entries for each ingredient
-- Option C: Use ingredient_id and keep a placeholder inventory_id

-- Let's try Option A first - make inventory_id nullable
-- But we need to be careful - if other parts of the system rely on NOT NULL, this could break things

-- DROP the NOT NULL constraint (if it exists)
ALTER TABLE pos_modifier_group_items
ALTER COLUMN inventory_id DROP NOT NULL;

-- Add a check constraint to ensure at least one of inventory_id or ingredient_id is set
ALTER TABLE pos_modifier_group_items
ADD CONSTRAINT pos_modifier_group_items_inventory_or_ingredient_check
CHECK (
    (inventory_id IS NOT NULL) OR (ingredient_id IS NOT NULL)
);

-- Verify the changes
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name = 'pos_modifier_group_items'
    AND column_name IN ('inventory_id', 'ingredient_id')
ORDER BY column_name;

-- Show the new constraint
SELECT 
    constraint_name,
    constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'public'
    AND table_name = 'pos_modifier_group_items'
    AND constraint_name LIKE '%inventory_or_ingredient%';