-- Step 1: Drop existing personal info functions
-- This migration safely drops all versions of the functions

DO $$ 
DECLARE
  func_record RECORD;
BEGIN
  -- Find and drop all create_user_from_personal_info_token functions
  FOR func_record IN 
    SELECT oid::regprocedure as func_name
    FROM pg_proc
    WHERE proname = 'create_user_from_personal_info_token'
  LOOP
    BEGIN
      EXECUTE 'DROP FUNCTION ' || func_record.func_name || ' CASCADE';
      RAISE NOTICE 'Dropped function: %', func_record.func_name;
    EXCEPTION 
      WHEN OTHERS THEN
        RAISE NOTICE 'Could not drop function: % - %', func_record.func_name, SQLERRM;
    END;
  END LOOP;
  
  -- Find and drop all update_user_personal_info_complete functions
  FOR func_record IN 
    SELECT oid::regprocedure as func_name
    FROM pg_proc
    WHERE proname = 'update_user_personal_info_complete'
  LOOP
    BEGIN
      EXECUTE 'DROP FUNCTION ' || func_record.func_name || ' CASCADE';
      RAISE NOTICE 'Dropped function: %', func_record.func_name;
    EXCEPTION 
      WHEN OTHERS THEN
        RAISE NOTICE 'Could not drop function: % - %', func_record.func_name, SQLERRM;
    END;
  END LOOP;
END $$;








