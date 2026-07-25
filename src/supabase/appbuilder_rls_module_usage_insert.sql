-- Step 38: Create RLS policy business_module_usage_insert
-- Policy: Owners/managers can INSERT module usage records
-- Uses existing user_roles table structure

DROP POLICY IF EXISTS "business_module_usage_insert" ON business_module_usage;

CREATE POLICY "business_module_usage_insert"
ON business_module_usage FOR INSERT
WITH CHECK (
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role IN ('owner', 'admin', 'manager')
            AND active = true
    )
);




