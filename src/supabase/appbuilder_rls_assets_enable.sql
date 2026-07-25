-- Step 44: Enable RLS on app_assets table and create policies
-- Note: RLS is already enabled in appbuilder_create_assets_table.sql

-- Verify RLS is enabled
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = 'app_assets' 
        AND schemaname = 'public'
        AND rowsecurity = true
    ) THEN
        ALTER TABLE app_assets ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- SELECT policy: Business members can view assets
DROP POLICY IF EXISTS "app_assets_select" ON app_assets;
CREATE POLICY "app_assets_select"
ON app_assets FOR SELECT
USING (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND active = true
    )
);

-- INSERT policy: Owners/managers can upload assets
DROP POLICY IF EXISTS "app_assets_insert" ON app_assets;
CREATE POLICY "app_assets_insert"
ON app_assets FOR INSERT
WITH CHECK (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role IN ('owner', 'admin', 'manager')
            AND active = true
    )
);

-- UPDATE policy: Owners/managers can update assets
DROP POLICY IF EXISTS "app_assets_update" ON app_assets;
CREATE POLICY "app_assets_update"
ON app_assets FOR UPDATE
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

-- DELETE policy: Owners/managers can delete assets
DROP POLICY IF EXISTS "app_assets_delete" ON app_assets;
CREATE POLICY "app_assets_delete"
ON app_assets FOR DELETE
USING (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role IN ('owner', 'admin', 'manager')
            AND active = true
    )
);




