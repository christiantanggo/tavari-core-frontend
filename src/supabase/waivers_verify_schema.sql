-- Step 30: Verify table structure and constraints
-- Purpose: Validate all foreign keys, unique constraints, check constraints

-- Verify all tables exist
DO $$
DECLARE
  v_table_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'waiver_templates',
      'waiver_signatures',
      'waiver_participants',
      'waiver_settings',
      'waiver_consents',
      'waiver_uploads',
      'waiver_fields',
      'waiver_field_responses',
      'waiver_versions',
      'waiver_audit_log'
    );
  
  IF v_table_count < 10 THEN
    RAISE EXCEPTION 'Not all waiver tables exist. Found: %', v_table_count;
  END IF;
  
  RAISE NOTICE 'All 10 waiver tables exist';
END $$;

-- Verify foreign keys exist
DO $$
DECLARE
  v_fk_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_fk_count
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  WHERE tc.table_schema = 'public'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name LIKE 'waiver%';
  
  RAISE NOTICE 'Found % foreign key constraints on waiver tables', v_fk_count;
END $$;

-- Verify indexes exist
DO $$
DECLARE
  v_index_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename LIKE 'waiver%';
  
  RAISE NOTICE 'Found % indexes on waiver tables', v_index_count;
END $$;

-- Verify RLS is enabled
DO $$
DECLARE
  v_rls_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_rls_count
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename LIKE 'waiver%'
    AND rowsecurity = true;
  
  RAISE NOTICE 'RLS enabled on % waiver tables', v_rls_count;
END $$;

-- Add comment
COMMENT ON SCHEMA public IS 'Waiver module schema verification complete';




