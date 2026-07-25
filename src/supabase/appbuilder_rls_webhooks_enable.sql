-- Step 46: Enable RLS on app_webhooks table and create policies
-- Note: RLS is already enabled in appbuilder_create_webhooks_table.sql
-- Full access for owners only (security sensitive)

-- Verify RLS is enabled
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = 'app_webhooks' 
        AND schemaname = 'public'
        AND rowsecurity = true
    ) THEN
        ALTER TABLE app_webhooks ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- SELECT policy: Owners can view webhooks
DROP POLICY IF EXISTS "app_webhooks_select" ON app_webhooks;
CREATE POLICY "app_webhooks_select"
ON app_webhooks FOR SELECT
USING (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role = 'owner'
            AND active = true
    )
);

-- INSERT policy: Owners can create webhooks
DROP POLICY IF EXISTS "app_webhooks_insert" ON app_webhooks;
CREATE POLICY "app_webhooks_insert"
ON app_webhooks FOR INSERT
WITH CHECK (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role = 'owner'
            AND active = true
    )
);

-- UPDATE policy: Owners can update webhooks
DROP POLICY IF EXISTS "app_webhooks_update" ON app_webhooks;
CREATE POLICY "app_webhooks_update"
ON app_webhooks FOR UPDATE
USING (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role = 'owner'
            AND active = true
    )
)
WITH CHECK (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role = 'owner'
            AND active = true
    )
);

-- DELETE policy: Owners can delete webhooks
DROP POLICY IF EXISTS "app_webhooks_delete" ON app_webhooks;
CREATE POLICY "app_webhooks_delete"
ON app_webhooks FOR DELETE
USING (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role = 'owner'
            AND active = true
    )
);




