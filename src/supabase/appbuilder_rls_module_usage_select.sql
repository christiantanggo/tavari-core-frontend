-- Step 37: Verify/Update RLS policy business_module_usage_select
-- RLS policy already exists - update it to allow owners/managers to view all business modules

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Employees can view module usage" ON business_module_usage;

-- Create updated policy that allows both employees (via tavari_employees) and owners/managers (via user_roles)
CREATE POLICY "Employees can view module usage"
ON business_module_usage FOR SELECT
USING (
    -- Employees can view via tavari_employees (existing pattern)
    EXISTS (
        SELECT 1 
        FROM tavari_employees 
        WHERE tavari_employees.user_id = auth.uid() 
            AND tavari_employees.is_active = true
    )
    OR
    -- Owners/managers can view all business modules via user_roles
    business_id IN (
        SELECT business_id 
        FROM user_roles 
        WHERE user_id = auth.uid() 
            AND role IN ('owner', 'admin', 'manager')
            AND active = true
    )
);




