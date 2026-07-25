-- Fix ingredients table foreign key constraint
-- The business_id should reference businesses(id), not business_users

-- First, let's check what the current constraint looks like
-- Run this to see current foreign keys:
-- SELECT 
--     tc.constraint_name, 
--     tc.table_name, 
--     kcu.column_name, 
--     ccu.table_name AS foreign_table_name,
--     ccu.column_name AS foreign_column_name 
-- FROM information_schema.table_constraints AS tc 
-- JOIN information_schema.key_column_usage AS kcu
--   ON tc.constraint_name = kcu.constraint_name
-- JOIN information_schema.constraint_column_usage AS ccu
--   ON ccu.constraint_name = tc.constraint_name
-- WHERE tc.constraint_type = 'FOREIGN KEY' 
--   AND tc.table_name = 'ingredients'
--   AND kcu.column_name = 'business_id';

-- Drop the existing foreign key constraint if it's incorrectly pointing to business_users
ALTER TABLE ingredients 
DROP CONSTRAINT IF EXISTS ingredients_business_id_fkey;

-- Add the correct foreign key constraint pointing to businesses table
ALTER TABLE ingredients 
ADD CONSTRAINT ingredients_business_id_fkey 
FOREIGN KEY (business_id) 
REFERENCES businesses(id) 
ON DELETE CASCADE;

-- Verify the constraint was created correctly
-- The constraint should now reference businesses(id), not business_users
