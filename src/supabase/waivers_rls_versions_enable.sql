-- Step 49: Enable RLS on waiver_versions table
-- Note: RLS is already enabled in the table creation, but this ensures it's enabled

-- RLS is already enabled in waivers_create_versions_table.sql
-- This file exists for consistency and documentation
DO $$
BEGIN
  -- Verify RLS is enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename = 'waiver_versions' 
      AND rowsecurity = true
  ) THEN
    ALTER TABLE waiver_versions ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Add comment
COMMENT ON TABLE waiver_versions IS 'RLS enabled - policies defined in waivers_rls_versions_policies';




