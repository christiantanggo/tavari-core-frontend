-- Step 32: Create RLS policy app_branding_select
-- Policy: Users can SELECT branding where they have business access
-- Uses existing user_roles table (matches pattern from other modules)

DROP POLICY IF EXISTS "app_branding_select" ON app_branding;

CREATE POLICY "app_branding_select"
ON app_branding FOR SELECT
USING (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND active = true
    )
);




