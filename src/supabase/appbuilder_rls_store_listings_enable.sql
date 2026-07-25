-- Step 42: Enable RLS on app_store_listings table and create policies
-- Note: RLS is already enabled in appbuilder_create_store_listings_table.sql

-- Verify RLS is enabled
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = 'app_store_listings' 
        AND schemaname = 'public'
        AND rowsecurity = true
    ) THEN
        ALTER TABLE app_store_listings ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- SELECT policy: Business members can view store listings
DROP POLICY IF EXISTS "app_store_listings_select" ON app_store_listings;
CREATE POLICY "app_store_listings_select"
ON app_store_listings FOR SELECT
USING (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND active = true
    )
);

-- INSERT policy: Owners/managers can create store listings
DROP POLICY IF EXISTS "app_store_listings_insert" ON app_store_listings;
CREATE POLICY "app_store_listings_insert"
ON app_store_listings FOR INSERT
WITH CHECK (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role IN ('owner', 'admin', 'manager')
            AND active = true
    )
);

-- UPDATE policy: Owners/managers can update store listings
DROP POLICY IF EXISTS "app_store_listings_update" ON app_store_listings;
CREATE POLICY "app_store_listings_update"
ON app_store_listings FOR UPDATE
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




