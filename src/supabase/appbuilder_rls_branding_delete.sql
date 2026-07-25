-- Step 35: Create RLS policy app_branding_delete
-- Policy: Only owners can DELETE branding

DROP POLICY IF EXISTS "app_branding_delete" ON app_branding;

CREATE POLICY "app_branding_delete"
ON app_branding FOR DELETE
USING (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role = 'owner'
            AND active = true
    )
);




