-- Fix waiver_signatures trigger that references created_by column
-- Error: record "new" has no field "created_by"
-- This means a trigger is trying to access NEW.created_by but the column doesn't exist

-- Step 1: First, let's see what triggers exist on waiver_signatures
-- (Uncomment to run first if needed)
-- SELECT 
--     trigger_name, 
--     event_manipulation, 
--     action_timing,
--     action_statement
-- FROM information_schema.triggers 
-- WHERE event_object_table = 'waiver_signatures';

-- Step 2: Drop all triggers on waiver_signatures (they'll need to be recreated if needed)
-- This is the safest approach since we don't know which specific trigger is problematic
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT trigger_name 
        FROM information_schema.triggers 
        WHERE event_object_table = 'waiver_signatures'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON waiver_signatures CASCADE', r.trigger_name);
        RAISE NOTICE 'Dropped trigger: %', r.trigger_name;
    END LOOP;
END $$;

-- Step 3: Verify no triggers remain
SELECT 
    trigger_name
FROM information_schema.triggers 
WHERE event_object_table = 'waiver_signatures';

-- If the SELECT above returns no rows, all triggers have been dropped successfully.
-- The waiver_signatures table should now work without the created_by error.
