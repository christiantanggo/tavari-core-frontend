-- Step 31: Enable RLS on app_branding table
-- Note: RLS is already enabled in appbuilder_create_branding_table.sql
-- This file verifies it's enabled

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = 'app_branding' 
        AND schemaname = 'public'
        AND rowsecurity = true
    ) THEN
        ALTER TABLE app_branding ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;




