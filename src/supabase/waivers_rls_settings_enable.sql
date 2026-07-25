-- Step 39: Enable RLS on waiver_settings table
-- Note: RLS is already enabled in the table creation, but this ensures it's enabled

-- RLS is already enabled in waivers_create_settings_table.sql
-- This file exists for consistency and documentation
DO $$
BEGIN
  -- Verify RLS is enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename = 'waiver_settings' 
      AND rowsecurity = true
  ) THEN
    ALTER TABLE waiver_settings ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Add comment
COMMENT ON TABLE waiver_settings IS 'RLS enabled - policies defined in waivers_rls_settings_policies';




