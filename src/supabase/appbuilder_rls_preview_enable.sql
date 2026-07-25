-- Step 43: Enable RLS on app_preview_configs table and create policies
-- Note: RLS is already enabled in appbuilder_create_preview_configs_table.sql

-- Verify RLS is enabled
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = 'app_preview_configs' 
        AND schemaname = 'public'
        AND rowsecurity = true
    ) THEN
        ALTER TABLE app_preview_configs ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- SELECT policy: Public read by share_token (for preview sharing)
DROP POLICY IF EXISTS "app_preview_configs_select_public" ON app_preview_configs;
CREATE POLICY "app_preview_configs_select_public"
ON app_preview_configs FOR SELECT
USING (
    -- Public access via share_token (for preview sharing)
    share_token IS NOT NULL
    AND expires_at > now()
);

-- SELECT policy: Business members can view all preview configs
DROP POLICY IF EXISTS "app_preview_configs_select_business" ON app_preview_configs;
CREATE POLICY "app_preview_configs_select_business"
ON app_preview_configs FOR SELECT
USING (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND active = true
    )
);

-- INSERT policy: Owners/managers can create preview configs
DROP POLICY IF EXISTS "app_preview_configs_insert" ON app_preview_configs;
CREATE POLICY "app_preview_configs_insert"
ON app_preview_configs FOR INSERT
WITH CHECK (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role IN ('owner', 'admin', 'manager')
            AND active = true
    )
);

-- UPDATE policy: Owners/managers can update preview configs
DROP POLICY IF EXISTS "app_preview_configs_update" ON app_preview_configs;
CREATE POLICY "app_preview_configs_update"
ON app_preview_configs FOR UPDATE
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

-- DELETE policy: Owners/managers can delete preview configs
DROP POLICY IF EXISTS "app_preview_configs_delete" ON app_preview_configs;
CREATE POLICY "app_preview_configs_delete"
ON app_preview_configs FOR DELETE
USING (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role IN ('owner', 'admin', 'manager')
            AND active = true
    )
);




