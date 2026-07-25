-- Step 45: Enable RLS on app_analytics table and create policies
-- Note: RLS is already enabled in appbuilder_create_analytics_table.sql

-- Verify RLS is enabled
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = 'app_analytics' 
        AND schemaname = 'public'
        AND rowsecurity = true
    ) THEN
        ALTER TABLE app_analytics ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- SELECT policy: Business members can view analytics
DROP POLICY IF EXISTS "app_analytics_select" ON app_analytics;
CREATE POLICY "app_analytics_select"
ON app_analytics FOR SELECT
USING (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND active = true
    )
);

-- INSERT policy: System/service_role can insert analytics (for backend operations)
DROP POLICY IF EXISTS "app_analytics_insert_service" ON app_analytics;
CREATE POLICY "app_analytics_insert_service"
ON app_analytics FOR INSERT
WITH CHECK (auth.role() = 'service_role');

-- INSERT policy: Authenticated users can insert their own analytics events
DROP POLICY IF EXISTS "app_analytics_insert_authenticated" ON app_analytics;
CREATE POLICY "app_analytics_insert_authenticated"
ON app_analytics FOR INSERT
WITH CHECK (
    auth.role() = 'authenticated'
    AND business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND active = true
    )
);




