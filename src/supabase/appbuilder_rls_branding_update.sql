-- Step 34: Create RLS policy app_branding_update
-- Policy: Users can UPDATE branding for businesses where they are owner/manager/admin
-- Uses same role check as INSERT

DROP POLICY IF EXISTS "app_branding_update" ON app_branding;

CREATE POLICY "app_branding_update"
ON app_branding FOR UPDATE
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




