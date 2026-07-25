-- Step 47: Enable RLS on waiver_field_responses table
-- Note: RLS is already enabled in the table creation, but this ensures it's enabled

-- RLS is already enabled in waivers_create_field_responses_table.sql
-- This file exists for consistency and documentation
DO $$
BEGIN
  -- Verify RLS is enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename = 'waiver_field_responses' 
      AND rowsecurity = true
  ) THEN
    ALTER TABLE waiver_field_responses ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Add comment
COMMENT ON TABLE waiver_field_responses IS 'RLS enabled - policies defined in waivers_rls_field_responses_policies';




