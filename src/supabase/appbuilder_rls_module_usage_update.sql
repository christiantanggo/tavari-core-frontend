-- Step 39: Create RLS policy business_module_usage_update
-- Policy: Owners/managers can UPDATE module usage (enable/disable modules)
-- Uses existing user_roles table structure

DROP POLICY IF EXISTS "business_module_usage_update" ON business_module_usage;

CREATE POLICY "business_module_usage_update"
ON business_module_usage FOR UPDATE
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




