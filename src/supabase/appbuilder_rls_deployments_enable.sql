-- Step 41: Enable RLS on app_deployments table and create policies
-- Note: RLS is already enabled in appbuilder_create_deployments_table.sql

-- Verify RLS is enabled
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = 'app_deployments' 
        AND schemaname = 'public'
        AND rowsecurity = true
    ) THEN
        ALTER TABLE app_deployments ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- SELECT policy: Business members can view deployments
DROP POLICY IF EXISTS "app_deployments_select" ON app_deployments;
CREATE POLICY "app_deployments_select"
ON app_deployments FOR SELECT
USING (
    build_id IN (
        SELECT ab.id 
        FROM app_builds ab
        WHERE ab.business_id IN (
            SELECT business_id 
            FROM user_roles 
            WHERE user_id = auth.uid() 
                AND active = true
        )
    )
);

-- INSERT policy: Owners/managers can create deployments
DROP POLICY IF EXISTS "app_deployments_insert" ON app_deployments;
CREATE POLICY "app_deployments_insert"
ON app_deployments FOR INSERT
WITH CHECK (
    build_id IN (
        SELECT ab.id 
        FROM app_builds ab
        WHERE ab.business_id IN (
            SELECT business_id 
            FROM user_roles 
            WHERE user_id = auth.uid() 
                AND role IN ('owner', 'admin', 'manager')
                AND active = true
        )
    )
);

-- UPDATE policy: Owners/managers can update deployments
DROP POLICY IF EXISTS "app_deployments_update" ON app_deployments;
CREATE POLICY "app_deployments_update"
ON app_deployments FOR UPDATE
USING (
    build_id IN (
        SELECT ab.id 
        FROM app_builds ab
        WHERE ab.business_id IN (
            SELECT business_id 
            FROM user_roles 
            WHERE user_id = auth.uid() 
                AND role IN ('owner', 'admin', 'manager')
                AND active = true
        )
    )
)
WITH CHECK (
    build_id IN (
        SELECT ab.id 
        FROM app_builds ab
        WHERE ab.business_id IN (
            SELECT business_id 
            FROM user_roles 
            WHERE user_id = auth.uid() 
                AND role IN ('owner', 'admin', 'manager')
                AND active = true
        )
    )
);




