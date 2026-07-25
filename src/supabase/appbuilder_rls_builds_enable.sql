-- Step 40: Enable RLS on app_builds table and create policies
-- Note: RLS is already enabled in appbuilder_create_builds_table.sql
-- This file creates the policies

-- Verify RLS is enabled
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = 'app_builds' 
        AND schemaname = 'public'
        AND rowsecurity = true
    ) THEN
        ALTER TABLE app_builds ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- SELECT policy: Business members can view builds
DROP POLICY IF EXISTS "app_builds_select" ON app_builds;
CREATE POLICY "app_builds_select"
ON app_builds FOR SELECT
USING (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND active = true
    )
);

-- INSERT policy: Owners/managers can create builds
DROP POLICY IF EXISTS "app_builds_insert" ON app_builds;
CREATE POLICY "app_builds_insert"
ON app_builds FOR INSERT
WITH CHECK (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role IN ('owner', 'admin', 'manager')
            AND active = true
    )
);

-- UPDATE policy: Owners/managers can update builds (for status changes)
DROP POLICY IF EXISTS "app_builds_update" ON app_builds;
CREATE POLICY "app_builds_update"
ON app_builds FOR UPDATE
USING (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role IN ('owner', 'admin', 'manager')
            AND active = true
    )
)
WITH CHECK (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role IN ('owner', 'admin', 'manager')
            AND active = true
    )
);




