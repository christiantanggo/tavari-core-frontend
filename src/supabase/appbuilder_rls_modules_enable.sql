-- Step 49: Create RLS policy for app_modules table (read-only)
-- Note: RLS is already enabled in appbuilder_create_modules_table.sql

-- Verify RLS is enabled
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = 'app_modules' 
        AND schemaname = 'public'
        AND rowsecurity = true
    ) THEN
        ALTER TABLE app_modules ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- SELECT policy: All authenticated users can view modules (global catalog)
DROP POLICY IF EXISTS "app_modules_select" ON app_modules;
CREATE POLICY "app_modules_select"
ON app_modules FOR SELECT
USING (auth.role() = 'authenticated');

-- No INSERT/UPDATE/DELETE for regular users (admin only via service role)
-- Service role can manage modules if needed (for system updates)




