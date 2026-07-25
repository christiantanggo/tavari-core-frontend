-- Check what foreign key constraints reference the users table
-- This will show what might be blocking user deletion

SELECT
  tc.table_name as referencing_table,
  kcu.column_name as referencing_column,
  ccu.table_name as referenced_table,
  ccu.column_name as referenced_column,
  tc.constraint_name,
  rc.delete_rule,
  rc.update_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
WHERE ccu.table_name = 'users'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;

-- Check if there are any records referencing the specific user IDs
-- Replace these UUIDs with the actual IDs from the error
DO $$
DECLARE
  old_user_id UUID := '938c70b1-0e74-43b0-a847-a93573488179';
  new_user_id UUID := 'c6553391-c6ab-4bd8-acbd-b813a2f2399e';
  v_count INT;
BEGIN
  RAISE NOTICE 'Checking references for old user_id: %', old_user_id;
  RAISE NOTICE 'Checking if new user_id exists: %', new_user_id;
  
  -- Check if new user_id already exists
  IF EXISTS (SELECT 1 FROM users WHERE id = new_user_id) THEN
    RAISE NOTICE '⚠️ New user_id already exists in users table!';
  ELSE
    RAISE NOTICE '✅ New user_id does not exist in users table';
  END IF;
  
  -- Check hr_contracts references
  SELECT COUNT(*) INTO v_count FROM hr_contracts WHERE employee_id = old_user_id;
  IF v_count > 0 THEN
    RAISE NOTICE '⚠️ hr_contracts references old user_id: % records', v_count;
  ELSE
    RAISE NOTICE '✅ No hr_contracts reference old user_id';
  END IF;
END $$;

