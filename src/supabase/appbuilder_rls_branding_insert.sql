-- Step 33: Create RLS policy app_branding_insert
-- Policy: Users can INSERT branding for businesses where they are owner/manager/admin
-- Uses existing user_roles table structure

DROP POLICY IF EXISTS "app_branding_insert" ON app_branding;

CREATE POLICY "app_branding_insert"
ON app_branding FOR INSERT
WITH CHECK (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role IN ('owner', 'admin', 'manager')
            AND active = true
    )
);




